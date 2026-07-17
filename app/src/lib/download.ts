// Téléchargement hors-ligne (SPEC : « vrai mode hors-ligne ») : matérialise en avance tout
// ce qu'il faut pour lire/écouter une histoire ou une leçon sans réseau, en COMPOSANT les
// primitives existantes (toutes idempotentes et cachées : R2 côté Worker, IndexedDB ici).
//
// - Histoire : traduction FR + QCM + illustration + audio TTS phrase par phrase (mêmes clés
//   de cache que le bouton « Écouter » du lecteur : tokens du tokenizer).
// - Leçon : cadrage du cours + toutes les histoires (locales + variantes R2) + leurs assets
//   + le pack podcast, dont l'audio est matérialisé ICI segment par segment (clés par
//   fragments voicés, distinctes des clés par tokens du lecteur d'histoire).
//
// File FIFO en mémoire, un téléchargement à la fois. PAS de persistance façon genJobs :
// chaque sous-étape étant idempotente, un téléchargement interrompu (reload) se relance
// d'un clic et avance instantanément sur tout ce qui est déjà en cache.
//
// L'état « téléchargé » est un flag explicite dans le store `meta`, posé APRÈS relecture
// de chaque clé audio dans le cache : il GARANTIT la lecture hors-ligne. Signature
// d'invalidation : nouvelle variante distante, curriculum ou format de pack changé →
// l'élément redevient « à télécharger ».
//
// Module volontairement SANS React (même pattern que genJobs.ts) : registre en mémoire +
// abonnés. Le pont UI vit dans ui/useDownloads.tsx.

import { analyze } from "./analyze";
import { getCurriculum, getCurriculumEntry } from "./curriculum";
import { getMeta, getStory, getStoryImage, getTtsCache, putMeta, type StoryRecord } from "./db";
import { jobsSnapshot, notifyDataChanged, subscribeJobs } from "./genJobs";
import { resolveGrammar } from "./inventory";
import {
  addLessonStory,
  backfillStoryImage,
  ensureLessonFraming,
  getLesson,
  objectivesHash,
  type Lesson,
} from "./lessons";
import { ensureStoryTranslationById, generatePodcastPack } from "./podcast";
import { PACK_VERSION, segmentParts } from "./podcastScript";
import { ensureComprehensionQuiz } from "./stories";
import { buildStorySegments } from "./storyPodcast";
import { synthesizeParts, synthesizeSentence, ttsPartsCacheId, ttsSentenceCacheId } from "./ttsClient";

export type DownloadKind = "story" | "lesson";
/** États d'une entrée du registre. « Téléchargé » n'y figure pas : c'est le flag meta. */
export type DownloadStatus = "queued" | "downloading" | "error";

export interface DownloadEntry {
  kind: DownloadKind;
  id: string; // storyId | lessonId
  status: DownloadStatus;
  /** Avancement dans [0, 1] (monotone). */
  fraction: number;
  /** Étape en cours, ex. « Audio 3/12… ». */
  label: string;
  error?: string;
}

interface Progress {
  fraction: number;
  label: string;
}
type OnProgress = (p: Progress) => void;

// ---- Flags « téléchargé » (store meta) ---------------------------------------

/** À incrémenter si le CONTENU d'un téléchargement change (nouvel asset requis). */
export const DOWNLOAD_VERSION = 2;

interface StoryDlMeta {
  at: number;
  version: number;
}

interface LessonDlMeta extends StoryDlMeta {
  /** Variantes locales au moment du téléchargement (histoire supprimée → invalide). */
  variants: number[];
  /** Empreinte des objectifs (curriculum changé sous le même id → invalide). */
  objectivesHash: string;
  rev: number;
  /** Version du format de pack podcast au moment du téléchargement. */
  packVersion: number;
}

const storyKey = (id: string) => `download.story.${id}`;
const lessonKey = (id: string) => `download.lesson.${id}`;

export async function isStoryDownloaded(storyId: string): Promise<boolean> {
  const meta = await getMeta<StoryDlMeta>(storyKey(storyId));
  return meta?.version === DOWNLOAD_VERSION;
}

/**
 * Une leçon est « téléchargée » si son flag est à jour ET que rien de nouveau n'est
 * apparu depuis : une variante distante non matérialisée, une histoire supprimée, un
 * curriculum ou un format de pack qui a changé font retomber l'état à « à télécharger ».
 */
export async function isLessonDownloaded(lesson: Lesson): Promise<boolean> {
  const meta = await getMeta<LessonDlMeta>(lessonKey(lesson.id));
  if (!meta || meta.version !== DOWNLOAD_VERSION) return false;
  if (meta.rev !== lesson.rev) return false;
  if (meta.objectivesHash !== objectivesHash(lesson)) return false;
  if (meta.packVersion !== PACK_VERSION) return false;
  if (lesson.remoteStoryVariants.length > 0) return false;
  const local = new Set(lesson.stories.map((s) => s.variant).filter((v): v is number => v != null));
  return meta.variants.every((v) => local.has(v));
}

// ---- Pipeline d'une histoire (partagé histoire seule / leçon) ----------------

/** Libellés + ids de grammaire pour le QCM, résolus comme dans le lecteur (Reader.tsx). */
function grammarForStory(story: StoryRecord): { ids: string[]; labels: string[] } | null {
  if (story.lessonId) {
    const entry = getCurriculumEntry(story.lessonId);
    if (entry) return { ids: entry.introduces.grammar, labels: entry.objectives.grammar };
  }
  const ids = story.params.grammarIds;
  if (ids?.length) return { ids, labels: ids.map(resolveGrammar) };
  return null;
}

/**
 * Matérialise l'audio d'une suite d'énoncés puis RELIT chaque clé dans le cache TTS :
 * toute absence fait échouer le téléchargement — le flag « téléchargé » doit GARANTIR la
 * lecture hors-ligne. Un échec ponctuel de synthèse (timeout, 5xx) est retenté une fois :
 * sur des dizaines d'énoncés en réseau mobile, un unique raté ne doit pas faire échouer
 * tout le téléchargement.
 */
async function materializeTts(
  items: { cacheId: string; synthesize: () => Promise<unknown> }[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    try {
      await items[i].synthesize();
    } catch {
      await items[i].synthesize();
    }
  }
  const hits = await Promise.all(items.map((it) => getTtsCache(it.cacheId)));
  const missing = hits.filter((h) => !h).length;
  if (missing > 0) throw new Error(`Audio manquant en cache (${missing}/${items.length}) — relancer le téléchargement.`);
}

/**
 * Matérialise tous les assets d'une histoire déjà enregistrée : traduction, QCM et
 * illustration en best-effort, puis l'audio phrase par phrase (clés par tokens, celles du
 * bouton « Écouter »), enfin VÉRIFIE que chaque phrase est bien en cache. Tout échec TTS
 * persistant (Worker sans clé compris) fait échouer le téléchargement.
 */
async function downloadStoryAssets(story: StoryRecord, onProgress: OnProgress): Promise<void> {
  const level = story.params.level ?? 5;

  onProgress({ fraction: 0, label: "Traduction…" });
  await ensureStoryTranslationById(story.id, story.text, level);

  onProgress({ fraction: 0.15, label: "Quiz de compréhension…" });
  const grammar = grammarForStory(story);
  if (grammar) {
    try {
      await ensureComprehensionQuiz(story.id, story.text, level, grammar);
    } catch {
      // QCM indisponible → le lecteur retombe sur la lecture sans quiz.
    }
  }

  onProgress({ fraction: 0.3, label: "Illustration…" });
  if (story.lessonId && story.variant != null && !(await getStoryImage(story.id))) {
    try {
      const image = await backfillStoryImage(story.id);
      // Même marqueur que StoryIllustration.tsx : le lecteur ne re-tentera pas.
      if (!image) await putMeta(`storyImageTried:${story.id}`, true);
    } catch {
      // Illustration best-effort : l'histoire reste lisible sans.
    }
  }

  onProgress({ fraction: 0.4, label: "Audio…" });
  const analyzed = await analyze(story.text);
  const segments = buildStorySegments(analyzed.tokens, story.id);
  await materializeTts(
    segments.map((s) => {
      const tokens = s.tokens ?? [s.text];
      return { cacheId: ttsSentenceCacheId(tokens), synthesize: () => synthesizeSentence(tokens, 0) };
    }),
    (done, total) => onProgress({ fraction: 0.4 + 0.6 * (done / total), label: `Audio ${done + 1}/${total}…` }),
  );
}

/** Télécharge une histoire et pose son flag. No-op si l'histoire n'existe plus (supprimée en file). */
export async function downloadStory(storyId: string, onProgress?: OnProgress): Promise<void> {
  const story = await getStory(storyId);
  if (!story) return;
  await downloadStoryAssets(story, onProgress ?? (() => {}));
  const meta: StoryDlMeta = { at: Date.now(), version: DOWNLOAD_VERSION };
  await putMeta(storyKey(storyId), meta);
  onProgress?.({ fraction: 1, label: "Téléchargée" });
}

// ---- Pipeline d'une leçon ----------------------------------------------------

/**
 * Attend qu'aucun job de génération ne tourne sur cette leçon : `addLessonStory` appelé en
 * parallèle depuis un job ET un téléchargement écrirait deux fois la même variante.
 */
async function waitForGenJobIdle(lessonId: string): Promise<void> {
  const busy = () => jobsSnapshot().some((j) => j.lessonId === lessonId && j.status === "running");
  while (busy()) {
    await new Promise<void>((resolve) => {
      const unsub = subscribeJobs(() => {
        unsub();
        resolve();
      });
    });
  }
}

/**
 * Télécharge une leçon complète (cours, histoires + assets, pack podcast + son audio) et
 * pose son flag. Ne démarre PAS la leçon (pas de `markLessonStarted`) : télécharger ≠
 * commencer — une leçon verrouillée reste verrouillée. No-op si la leçon n'existe pas.
 */
export async function downloadLesson(lessonId: string, onProgress?: OnProgress): Promise<void> {
  const p = onProgress ?? (() => {});
  await waitForGenJobIdle(lessonId);
  let lesson = await getLesson(lessonId);
  if (!lesson) return;

  p({ fraction: 0, label: "Préparation du cours…" });
  await ensureLessonFraming(lesson);

  // Histoires manquantes : toutes les variantes R2 non matérialisées ; s'il n'existe
  // vraiment rien, on génère la première (télécharger implique générer).
  const missing = [...lesson.remoteStoryVariants];
  if (lesson.stories.length === 0 && missing.length === 0) missing.push(1);
  for (let i = 0; i < missing.length; i++) {
    p({ fraction: 0.1 + 0.15 * (i / missing.length), label: `Téléchargement de l'histoire ${missing[i]}…` });
    lesson = (await getLesson(lessonId)) ?? lesson;
    if (!lesson.stories.some((s) => s.variant === missing[i])) {
      await addLessonStory(lesson, missing[i]);
    }
  }

  lesson = (await getLesson(lessonId)) ?? lesson;
  const stories = lesson.stories;
  for (let i = 0; i < stories.length; i++) {
    const base = 0.25 + (0.45 * i) / Math.max(1, stories.length);
    const span = 0.45 / Math.max(1, stories.length);
    const prefix = stories.length > 1 ? `Histoire ${i + 1} — ` : "";
    await downloadStoryAssets(stories[i], ({ fraction, label }) =>
      p({ fraction: base + span * fraction, label: `${prefix}${label}` }),
    );
    // Flag par histoire aussi : les lignes de l'onglet Histoires se montrent téléchargées.
    const storyMeta: StoryDlMeta = { at: Date.now(), version: DOWNLOAD_VERSION };
    await putMeta(storyKey(stories[i].id), storyMeta);
  }

  // Pack podcast : mêmes paramètres de navigation que le lecteur (usePodcastPlayer) pour
  // que le pack mis en cache soit exactement celui qu'il réutilisera.
  const order = getCurriculum();
  const idx = order.findIndex((c) => c.id === lessonId);
  const nextEntry = idx >= 0 ? order[idx + 1] : undefined;
  p({ fraction: 0.7, label: "Pack podcast…" });
  const pack = await generatePodcastPack(lessonId, { nextLessonTitle: nextEntry?.title }, (msg) =>
    p({ fraction: 0.7, label: msg }),
  );

  // Matérialise l'audio du pack (une synthèse par segment parlé, multi-voix comprise).
  // Même routage que le lecteur (segmentPlayer.synthClip) : segment tokenisé → phrase avec
  // timepoints (cache partagé avec la lecture standalone, déjà matérialisé ci-dessus).
  await materializeTts(
    pack.segments
      .filter((s) => s.text.trim())
      .map((s) => {
        if (s.tokens) {
          const tokens = s.tokens;
          return { cacheId: ttsSentenceCacheId(tokens), synthesize: () => synthesizeSentence(tokens, 0) };
        }
        const parts = segmentParts(s);
        return { cacheId: ttsPartsCacheId(parts), synthesize: () => synthesizeParts(parts) };
      }),
    (done, total) => p({ fraction: 0.72 + 0.28 * (done / Math.max(1, total)), label: `Audio du pack ${done + 1}/${total}…` }),
  );

  lesson = (await getLesson(lessonId)) ?? lesson;
  const meta: LessonDlMeta = {
    at: Date.now(),
    version: DOWNLOAD_VERSION,
    variants: lesson.stories.map((s) => s.variant).filter((v): v is number => v != null),
    objectivesHash: objectivesHash(lesson),
    rev: lesson.rev,
    packVersion: PACK_VERSION,
  };
  await putMeta(lessonKey(lessonId), meta);
  p({ fraction: 1, label: "Téléchargée" });
}

// ---- File FIFO + registre en mémoire ------------------------------------------

const entries = new Map<string, DownloadEntry>();
const fifo: string[] = [];
const listeners = new Set<() => void>();
let running = false;

const keyOf = (kind: DownloadKind, id: string) => `${kind}:${id}`;

function emit(): void {
  for (const l of listeners) l();
}

/** S'abonne aux changements d'état des téléchargements. Renvoie la fonction de désabonnement. */
export function subscribeDownloads(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Snapshot synchrone du registre (pour le rendu). */
export function downloadsSnapshot(): DownloadEntry[] {
  return [...entries.values()];
}

/** Entrée live d'un élément (undefined si jamais téléchargé dans cette session). */
export function getDownloadEntry(kind: DownloadKind, id: string): DownloadEntry | undefined {
  return entries.get(keyOf(kind, id));
}

/** Met un téléchargement en file. No-op s'il est déjà en file ou en cours. */
export function enqueueDownload(kind: DownloadKind, id: string): void {
  const key = keyOf(kind, id);
  const existing = entries.get(key);
  if (existing && (existing.status === "queued" || existing.status === "downloading")) return;
  entries.set(key, { kind, id, status: "queued", fraction: 0, label: "En attente…" });
  fifo.push(key);
  emit();
  void pump();
}

/** Retire un téléchargement encore EN FILE (pas celui en cours) — annuler un mauvais clic. */
export function cancelQueued(kind: DownloadKind, id: string): void {
  const key = keyOf(kind, id);
  if (entries.get(key)?.status !== "queued") return;
  const i = fifo.indexOf(key);
  if (i >= 0) fifo.splice(i, 1);
  entries.delete(key);
  emit();
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (fifo.length > 0) {
      const key = fifo.shift()!;
      const entry = entries.get(key);
      if (!entry || entry.status !== "queued") continue;
      entry.status = "downloading";
      entry.label = "Téléchargement…";
      emit();
      try {
        const onProgress: OnProgress = ({ fraction, label }) => {
          entry.fraction = Math.max(entry.fraction, Math.min(1, fraction));
          entry.label = label;
          emit();
        };
        if (entry.kind === "story") await downloadStory(entry.id, onProgress);
        else await downloadLesson(entry.id, onProgress);
        // Terminé (ou cible disparue) : le flag meta est la seule source de vérité de
        // l'état « téléchargé » — garder une entrée « done » ici masquerait une
        // invalidation ultérieure (ex. nouvelle variante distante).
        entries.delete(key);
        emit();
        // Une leçon a pu matérialiser des histoires → les listes se rechargent.
        if (entry.kind === "lesson") notifyDataChanged();
      } catch (e) {
        entry.status = "error";
        entry.error = String(e instanceof Error ? e.message : e);
        emit();
      }
    }
  } finally {
    running = false;
  }
}

/** Réservé aux tests : vide registre et file. */
export function _resetDownloadsForTests(): void {
  entries.clear();
  fifo.length = 0;
  listeners.clear();
  running = false;
}
