// File de génération de contenu PERSISTANTE (cours + histoire d'une leçon).
//
// Pourquoi : la génération passe par un aller-retour synchrone vers le Worker (genClient).
// Si l'utilisateur recharge ou quitte la page pendant ce temps, le fetch est annulé et le
// travail semblait perdu. Ici, chaque génération est enregistrée comme un *job* dans
// IndexedDB ; au redémarrage de l'app, les jobs « en cours » sont REPRIS automatiquement.
// Comme le Worker met en cache (R2) tout ce qu'il produit sous une clé déterministe,
// reprendre un job revient à redemander le contenu : il est servi depuis le cache s'il a
// fini côté serveur, sinon il est régénéré (idempotent). L'utilisateur voit donc la
// génération « continuer » et peut suivre sa progression d'un écran à l'autre.
//
// Séquencement (clic « Commencer ») : on génère D'ABORD le cours (framing), on rend la
// leçon accessible, PUIS on génère l'histoire — au lieu d'attendre les deux d'un bloc.
//
// Ce module est volontairement SANS React : un registre en mémoire + des abonnés, piloté
// par db.ts. Le pont vers l'UI (notifications, rafraîchissement) se fait via `configureJobs`.

import {
  allGenJobs,
  deleteGenJob,
  deleteStory,
  putGenJob,
  type GenJobPhase,
  type GenJobRecord,
  type StoryRecord,
} from "./db";
import {
  addLessonStory,
  ensureLessonFraming,
  getLesson,
  invalidateGeneratedIndex,
  markLessonStarted,
  nextStoryVariant,
  type Lesson,
} from "./lessons";

export type { GenJobPhase, GenJobRecord };

export interface JobDoneEvent {
  lessonId: string;
  title: string;
  /** Histoire fraîchement générée (présente sauf si le job a été repris déjà terminé). */
  story?: StoryRecord;
  /** Le job incluait la génération du cours (clic « Commencer »). */
  withFraming: boolean;
  /** Contenu servi depuis R2 (pré-généré) — pas de notification nécessaire. */
  fromCache: boolean;
}

type ChangeListener = () => void;

// Registre en mémoire des jobs (miroir d'IndexedDB) : accès synchrone pour le rendu.
const jobs = new Map<string, GenJobRecord>();
const listeners = new Set<ChangeListener>();
let onDone: ((e: JobDoneEvent) => void) | null = null;
let onDataChange: (() => void) | null = null;
let resumed = false;

function emit(): void {
  for (const l of listeners) l();
}

/** S'abonne aux changements d'état des jobs (re-render UI). Renvoie la fonction de désabonnement. */
export function subscribeJobs(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Snapshot synchrone des jobs en mémoire (pour le rendu). */
export function jobsSnapshot(): GenJobRecord[] {
  return [...jobs.values()];
}

/** Un job tourne-t-il ? (sert à cadencer la barre de progression côté UI). */
export function hasRunningJob(): boolean {
  for (const j of jobs.values()) if (j.status === "running") return true;
  return false;
}

/** Branche les effets de bord côté UI (notifications, rafraîchissement des listes). */
export function configureJobs(hooks: {
  onDone?: (e: JobDoneEvent) => void;
  onDataChange?: () => void;
}): void {
  onDone = hooks.onDone ?? null;
  onDataChange = hooks.onDataChange ?? null;
}

async function persist(job: GenJobRecord): Promise<void> {
  job.updatedAt = Date.now();
  jobs.set(job.lessonId, job);
  await putGenJob(job);
  emit();
}

function setPhase(job: GenJobRecord, phase: GenJobPhase): void {
  job.phase = phase;
  job.phaseStartedAt = Date.now();
}

async function remove(lessonId: string): Promise<void> {
  jobs.delete(lessonId);
  await deleteGenJob(lessonId);
  emit();
}

/**
 * Exécute (ou reprend) un job. Chaque étape est idempotente :
 *  - le cours est sauté s'il existe déjà (framing présent) ;
 *  - l'histoire est sautée si la variante visée est déjà enregistrée.
 * Un échec marque le job en erreur (relançable) sans le perdre.
 */
async function run(job: GenJobRecord): Promise<void> {
  try {
    let lesson = await getLesson(job.lessonId);
    if (!lesson) {
      await remove(job.lessonId);
      return;
    }
    const fromCache = lesson.pregenerated;

    // Phase 1 — le cours (framing), puis on rend la leçon accessible immédiatement.
    if (job.withFraming) {
      // Absent, périmé (curriculum changé sous cet id), OU régénération forcée demandée.
      if (!lesson.framing || lesson.framingStale || job.refresh) {
        setPhase(job, "framing");
        await persist(job);
        await ensureLessonFraming(lesson, undefined, { force: job.refresh });
      }
      await markLessonStarted(lesson.id);
      onDataChange?.(); // le cours est disponible → la leçon devient lisible
      lesson = (await getLesson(job.lessonId)) ?? lesson;
    }

    // Régénération du cours seul (« Régénérer le cours ») : on n'ajoute/ne remplace aucune histoire.
    if (job.framingOnly) {
      await remove(job.lessonId);
      invalidateGeneratedIndex();
      onDataChange?.();
      onDone?.({ lessonId: job.lessonId, title: lesson.title, withFraming: true, fromCache });
      return;
    }

    // Phase 2 — l'histoire, contrainte au lexique déjà vu. En régénération (`refresh`), on
    // ignore une éventuelle histoire déjà présente pour cette variante et on force du neuf
    // (le cache R2 du Worker est aussi contourné, voir addLessonStory).
    setPhase(job, "story");
    await persist(job);
    let story = job.refresh ? undefined : lesson.stories.find((s) => s.variant === job.variant);
    if (!story) story = await addLessonStory(lesson, job.variant, undefined, { refresh: job.refresh });

    await remove(job.lessonId);
    invalidateGeneratedIndex();
    onDataChange?.();
    onDone?.({ lessonId: job.lessonId, title: lesson.title, story, withFraming: job.withFraming, fromCache });
  } catch (e) {
    job.status = "error";
    job.error = String(e);
    await persist(job);
  }
}

/** Lance la génération complète d'une leçon (cours + 1re histoire). No-op si déjà en cours. */
export async function startLessonJob(lesson: Lesson): Promise<void> {
  if (jobs.get(lesson.id)?.status === "running") return;
  const now = Date.now();
  const job: GenJobRecord = {
    lessonId: lesson.id,
    title: lesson.title,
    withFraming: true,
    variant: 1,
    phase: "framing",
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
  };
  jobs.set(lesson.id, job);
  await putGenJob(job);
  emit();
  void run(job);
}

/** Lance la génération d'une histoire supplémentaire (variante explicite ou suivante). */
export async function addStoryJob(lesson: Lesson, variant?: number): Promise<void> {
  if (jobs.get(lesson.id)?.status === "running") return;
  const resolved = variant ?? nextStoryVariant(lesson);
  const now = Date.now();
  const job: GenJobRecord = {
    lessonId: lesson.id,
    title: lesson.title,
    withFraming: false,
    variant: resolved,
    phase: "story",
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
  };
  jobs.set(lesson.id, job);
  await putGenJob(job);
  emit();
  void run(job);
}

/**
 * Régénère une histoire jugée mauvaise : supprime l'histoire fautive (et son image), puis
 * régénère la MÊME variante en contournant le cache R2 (`refresh`) — du contenu neuf, pas
 * l'ancien resservi. No-op si un job tourne déjà pour cette leçon.
 */
export async function regenerateStoryJob(lesson: Lesson, story: StoryRecord): Promise<void> {
  if (jobs.get(lesson.id)?.status === "running") return;
  const variant = story.variant ?? nextStoryVariant(lesson);
  // Enregistre d'abord le job (barre de progression visible), PUIS retire l'histoire fautive :
  // la liste se rafraîchit avec la régénération déjà « en cours », sans clignotement.
  const now = Date.now();
  const job: GenJobRecord = {
    lessonId: lesson.id,
    title: lesson.title,
    withFraming: false,
    variant,
    refresh: true,
    phase: "story",
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
  };
  jobs.set(lesson.id, job);
  await putGenJob(job);
  emit();
  await deleteStory(story.id);
  invalidateGeneratedIndex();
  onDataChange?.();
  void run(job);
}

/**
 * Régénère le cours (framing) jugé mauvais, en contournant le cache R2. Ne touche à aucune
 * histoire. L'ancien cours reste affiché pendant la régénération et est conservé si elle
 * échoue (voir ensureLessonFraming). No-op si un job tourne déjà pour cette leçon.
 */
export async function regenerateFramingJob(lesson: Lesson): Promise<void> {
  if (jobs.get(lesson.id)?.status === "running") return;
  const now = Date.now();
  const job: GenJobRecord = {
    lessonId: lesson.id,
    title: lesson.title,
    withFraming: true,
    framingOnly: true,
    refresh: true,
    variant: 1,
    phase: "framing",
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
  };
  jobs.set(lesson.id, job);
  await putGenJob(job);
  emit();
  void run(job);
}

/** Relance un job tombé en erreur. */
export async function retryJob(lessonId: string): Promise<void> {
  const job = jobs.get(lessonId);
  if (!job || job.status === "running") return;
  job.status = "running";
  job.error = undefined;
  setPhase(job, job.phase);
  await persist(job);
  void run(job);
}

/** Oublie un job en erreur (l'utilisateur abandonne). */
export async function dismissJob(lessonId: string): Promise<void> {
  const job = jobs.get(lessonId);
  if (job && job.status === "error") await remove(lessonId);
}

/**
 * Reprend au démarrage les jobs persistés. Les jobs « en cours » sont relancés (le Worker
 * sert le cache R2 s'il a déjà fini, sinon régénère) ; les jobs en erreur restent visibles
 * (bouton « Réessayer ») sans relance automatique. Idempotent.
 */
export async function resumeJobs(): Promise<void> {
  if (resumed) return;
  resumed = true;
  const persisted = await allGenJobs();
  for (const job of persisted) jobs.set(job.lessonId, job);
  emit();
  for (const job of persisted) {
    if (job.status === "running") void run(job);
  }
}

// ---- Estimation de progression ---------------------------------------------
// La génération est UN appel LLM opaque : aucune progression réelle ne remonte. On affiche
// donc une estimation rassurante par phase, asymptotique (ralentit en approchant du plafond,
// n'atteint jamais 100 % avant la fin réelle).

const FRAMING_CEIL = 0.4; // le cours occupe les 40 premiers pourcents d'un job complet
const TAU_FRAMING = 16_000;
const TAU_STORY = 28_000;

/** Avancement estimé d'un job dans [0, 0.99]. */
export function jobProgress(job: GenJobRecord, now: number = Date.now()): number {
  const elapsed = Math.max(0, now - job.phaseStartedAt);
  const grow = (tau: number) => 1 - Math.exp(-elapsed / tau);
  if (job.phase === "framing") {
    return Math.min(0.99, FRAMING_CEIL * grow(TAU_FRAMING));
  }
  const base = job.withFraming ? FRAMING_CEIL : 0;
  return Math.min(0.99, base + (1 - base) * grow(TAU_STORY));
}

/** Libellé d'état lisible pour un job. */
export function jobLabel(job: GenJobRecord): string {
  if (job.status === "error") return "Échec de la génération";
  return job.phase === "framing" ? "Génération du cours…" : "Génération de l'histoire…";
}
