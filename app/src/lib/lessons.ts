// Curriculum + leçons : fusionne le plan statique (curriculum.json) avec le
// contenu généré et la progression locale (IndexedDB).
//
// Une « leçon » est :
// - prête  : cours + histoire disponibles (via seed ou via génération antérieure).
// - à générer : seulement les objectifs sont définis ; l'utilisateur peut lancer la génération.
// - terminée : marquée lue ; n'empêche pas de la relire.

import { fetchGenerated, generateLesson, generateLessonStory, type GeneratedIndex, type GenState } from "./genClient";
import { saveStory } from "./stories";
import {
  getCumulativeObjectives,
  getCurriculum,
  getCurriculumEntry,
  type CurriculumEntry,
} from "./curriculum";
import {
  allGrammar,
  allVocab,
  getGeneratedLesson,
  getLessonProgress,
  putGeneratedLesson,
  putLessonProgress,
  storiesForLesson,
  type GeneratedLessonRecord,
  type GrammarItem,
  type LessonProgressRecord,
  type StoryRecord,
  type VocabItem,
} from "./db";
import { enrollLesson } from "./enroll";
import { sample } from "./random";
import { isMastered, isUnlockReady, type Card } from "./srs";
import { SRS } from "./config";

/** Une leçon est « prête » dès qu'elle a au moins une histoire à lire (locale ou distante). */
export type LessonState = "ready" | "to-generate";

export interface Lesson extends CurriculumEntry {
  state: LessonState;
  /** Cadrage généré du cours (Markdown), complète le cours assemblé depuis l'inventaire. */
  framing?: string;
  /** Histoires rattachées (seed matérialisé + générées), via le pipeline `stories`. */
  stories: StoryRecord[];
  completedAt?: number;
  startedAt?: number;
  /** Contenu pré-généré disponible en cache R2 (cours + au moins une histoire). */
  pregenerated: boolean;
  /** Numéros de variantes disponibles en R2 mais pas encore matérialisées localement. */
  remoteStoryVariants: number[];
  /** Part des items maîtrisés (0..1) — intervalle ≥ 21 j, objectif long terme affiché. */
  mastery: number;
  /** Part des items assez stables pour le déblocage (0..1) — seuil léger, voir isUnlockReady. */
  unlockProgress: number;
  /** La leçon est-elle verrouillée par le seuil de déblocage de la précédente ? */
  locked: boolean;
  /** Progression de déblocage de la leçon précédente (pour la jauge du verrou). */
  prevUnlockProgress?: number;
  /** Titre de la leçon précédente (pour le message de débloquage). */
  prevTitle?: string;
  /** Leçon débloquée naturellement (par maîtrise, pas par "commencer quand même"). */
  unlockedNaturally?: boolean;
  /** La notification de déblocage a-t-elle déjà été envoyée ? */
  notifiedUnlock?: boolean;
  /**
   * Le cours local a été généré pour d'AUTRES objectifs (le curriculum a changé sous
   * ce même id) : à régénérer à l'ouverture. L'ancien cours reste affiché en attendant.
   */
  framingStale?: boolean;
}

/**
 * Empreinte stable des objectifs d'une leçon (FNV-1a hex) : titre, niveau et items
 * introduits. Stockée avec le cours généré (GeneratedLessonRecord.objectivesHash) pour
 * détecter un curriculum qui a changé sous un même id de leçon. Les histoires, elles,
 * ne sont volontairement PAS invalidées : une histoire déjà générée reste une matière
 * à lire valable — seule la partie pédagogique (le cours) doit suivre les objectifs.
 */
export function objectivesHash(
  entry: Pick<CurriculumEntry, "title" | "level" | "introduces">,
): string {
  const material = JSON.stringify({
    title: entry.title,
    level: entry.level,
    vocab: entry.introduces.vocab,
    grammar: entry.introduces.grammar,
  });
  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// Promesse mémoïsée de l'index R2 : un seul appel par session, même si listLessons est rappelé.
// On ne mémoïse pas les échecs (réseau flaky) : si fetchGenerated échoue, la prochaine hydration
// retente.
let _generatedIndexPromise: Promise<GeneratedIndex> | null = null;
function loadGeneratedIndex(): Promise<GeneratedIndex> {
  if (!_generatedIndexPromise) {
    _generatedIndexPromise = fetchGenerated().catch(() => {
      _generatedIndexPromise = null;
      return {} as GeneratedIndex;
    });
  }
  return _generatedIndexPromise;
}

/** Force le rechargement de l'index R2 au prochain appel (après une génération). */
export function invalidateGeneratedIndex(): void {
  _generatedIndexPromise = null;
}

/** Part des items d'une leçon dont la carte satisfait `pred` (0..1). */
function computeProgress(
  entry: Pick<CurriculumEntry, "introduces">,
  vocabMap: Map<string, VocabItem>,
  grammarMap: Map<string, GrammarItem>,
  pred: (card: Card) => boolean,
): number {
  let total = 0;
  let ok = 0;
  for (const id of entry.introduces.vocab) {
    total++;
    const card = vocabMap.get(id)?.cards.written;
    if (card && pred(card)) ok++;
  }
  for (const id of entry.introduces.grammar) {
    total++;
    const card = grammarMap.get(id)?.card;
    if (card && pred(card)) ok++;
  }
  return total === 0 ? 0 : ok / total;
}

/** Calcule la part des items d'une leçon qui sont maîtrisés (0..1) — affichage long terme. */
export function computeMastery(
  entry: Pick<CurriculumEntry, "introduces">,
  vocabMap: Map<string, VocabItem>,
  grammarMap: Map<string, GrammarItem>,
): number {
  return computeProgress(entry, vocabMap, grammarMap, isMastered);
}

/** Part des items assez stables pour débloquer la leçon suivante (0..1) — seuil léger. */
export function computeUnlockProgress(
  entry: Pick<CurriculumEntry, "introduces">,
  vocabMap: Map<string, VocabItem>,
  grammarMap: Map<string, GrammarItem>,
): number {
  return computeProgress(entry, vocabMap, grammarMap, isUnlockReady);
}

/** Marque la leçon comme terminée dès que sa progression de déblocage atteint le seuil. */
function maybeAutoComplete(lesson: Lesson): void {
  if (lesson.completedAt || !lesson.startedAt || lesson.unlockProgress < SRS.unlockMastery) return;
  lesson.completedAt = Date.now();
  void markLessonCompleted(lesson.id);
}

async function hydrate(
  entry: CurriculumEntry,
  remoteIndex: GeneratedIndex,
): Promise<Lesson> {
  const [generated, progress, stories] = await Promise.all([
    getGeneratedLesson(entry.id),
    getLessonProgress(entry.id),
    storiesForLesson(entry.id),
  ]);

  const remote = remoteIndex[entry.id];
  // Un contenu généré pour une révision antérieure du curriculum (objectifs différents)
  // est ignoré : la leçon se régénère comme si elle n'avait jamais été produite.
  const remoteCoursOk = Boolean(remote?.cours) && (remote?.coursRev ?? 1) === entry.rev;
  const localFraming = (generated?.rev ?? 1) === entry.rev ? generated?.framing : undefined;
  const pregenerated = Boolean(remoteCoursOk && remote && remote.stories.length > 0);
  const localVariants = new Set(stories.map((s) => s.variant).filter((v): v is number => v != null));
  const remoteStoryVariants = (remote?.stories ?? []).filter((v) => !localVariants.has(v)).sort((a, b) => a - b);

  return {
    ...entry,
    // Accessible (cours lisible) dès que le cadrage existe localement, qu'une histoire est
    // disponible (locale ou pré-générée distante). L'histoire peut alors se générer en
    // arrière-plan sans bloquer l'accès au cours.
    state: localFraming || stories.length > 0 || pregenerated ? "ready" : "to-generate",
    framing: localFraming,
    // Cours généré pour d'autres objectifs (ou avant l'empreinte) → périmé.
    framingStale: !!localFraming && generated?.objectivesHash !== objectivesHash(entry),
    stories,
    completedAt: progress?.completedAt,
    startedAt: progress?.startedAt,
    pregenerated,
    remoteStoryVariants,
    mastery: 0,
    unlockProgress: 0,
    locked: false,
    notifiedUnlock: progress?.unlockedNotified ?? false,
  };
}

/** Charge les items SRS indexés par id (pour le calcul de maîtrise). */
async function loadSrsMaps(): Promise<{
  vocabMap: Map<string, VocabItem>;
  grammarMap: Map<string, GrammarItem>;
}> {
  const [allVocabItems, allGrammarItems] = await Promise.all([allVocab(), allGrammar()]);
  return {
    vocabMap: new Map(allVocabItems.map((v) => [v.id, v])),
    grammarMap: new Map(allGrammarItems.map((g) => [g.id, g])),
  };
}

export async function listLessons(): Promise<Lesson[]> {
  const remoteIndex = await loadGeneratedIndex();
  const { vocabMap, grammarMap } = await loadSrsMaps();

  const lessons = await Promise.all(
    getCurriculum().map((e) => hydrate(e, remoteIndex)),
  );

  for (let i = 0; i < lessons.length; i++) {
    lessons[i].mastery = computeMastery(lessons[i], vocabMap, grammarMap);
    lessons[i].unlockProgress = computeUnlockProgress(lessons[i], vocabMap, grammarMap);
    maybeAutoComplete(lessons[i]);
    const prev = i > 0 ? lessons[i - 1] : null;
    const prevUnlock = prev ? prev.unlockProgress : 1;
    lessons[i].prevUnlockProgress = prev ? prevUnlock : undefined;
    lessons[i].prevTitle = prev ? prev.title : undefined;
    lessons[i].locked = !!prev && prevUnlock < SRS.unlockMastery && !lessons[i].startedAt;
    lessons[i].unlockedNaturally =
      !!prev &&
      prevUnlock >= SRS.unlockMastery &&
      !lessons[i].startedAt &&
      !lessons[i].completedAt &&
      lessons[i].state === "ready" &&
      !lessons[i].notifiedUnlock;
  }

  return lessons;
}

/** Ids de grammaire introduits par une leçon débloquée (non verrouillée), pour la mise en avant. */
export async function getUnlockedGrammarIds(): Promise<string[]> {
  const lessons = await listLessons();
  const ids = new Set<string>();
  for (const l of lessons) {
    if (l.locked) continue;
    for (const g of l.introduces.grammar) ids.add(g);
  }
  return [...ids];
}

export async function getLesson(id: string): Promise<Lesson | undefined> {
  const entry = getCurriculumEntry(id);
  if (!entry) return undefined;
  const remoteIndex = await loadGeneratedIndex();
  const { vocabMap, grammarMap } = await loadSrsMaps();
  const lesson = await hydrate(entry, remoteIndex);
  lesson.mastery = computeMastery(lesson, vocabMap, grammarMap);
  lesson.unlockProgress = computeUnlockProgress(lesson, vocabMap, grammarMap);
  maybeAutoComplete(lesson);
  // locked non calculable sans la leçon précédente
  lesson.locked = false;
  lesson.prevUnlockProgress = undefined;
  return lesson;
}

export async function markUnlockNotified(lessonId: string): Promise<void> {
  const prev = (await getLessonProgress(lessonId)) ?? { id: lessonId };
  await putLessonProgress({ ...prev, unlockedNotified: true });
}

/** Met en cache le cadrage de cours généré (les histoires, elles, passent par `saveStory`). */
async function saveLesson(
  id: string,
  framing: string,
  rev: number,
  entry: Pick<CurriculumEntry, "title" | "level" | "introduces">,
): Promise<GeneratedLessonRecord> {
  const rec: GeneratedLessonRecord = {
    id,
    framing,
    createdAt: Date.now(),
    rev,
    objectivesHash: objectivesHash(entry),
  };
  await putGeneratedLesson(rec);
  return rec;
}

export async function markLessonStarted(id: string): Promise<void> {
  const prev = (await getLessonProgress(id)) ?? { id };
  const next: LessonProgressRecord = { ...prev, startedAt: prev.startedAt ?? Date.now() };
  await putLessonProgress(next);
  void enrollLesson(id);
}

async function markLessonCompleted(id: string): Promise<void> {
  const prev = (await getLessonProgress(id)) ?? { id };
  const next: LessonProgressRecord = {
    ...prev,
    startedAt: prev.startedAt ?? Date.now(),
    completedAt: Date.now(),
  };
  await putLessonProgress(next);
}

// ---- Génération de contenu d'une leçon (partagée UI / podcast) --------------

/**
 * S'assure que le cadrage du cours existe ET correspond aux objectifs courants de la
 * leçon : le génère s'il manque, le RÉGÉNÈRE s'il est périmé (objectifs changés sous le
 * même id et la même révision — `refresh: true` car la clé R2 du Worker est par id/rev et
 * resservirait l'ancien cours). En cas d'échec de régénération, l'ancien cours est
 * conservé tel quel.
 */
export async function ensureLessonFraming(
  lesson: Lesson,
  onState?: (s: GenState) => void,
): Promise<string | undefined> {
  if (lesson.framing && !lesson.framingStale) return lesson.framing;
  const framing = await generateLesson(
    {
      lessonId: lesson.id,
      title: lesson.title,
      level: lesson.level,
      vocab: lesson.objectives.vocab,
      grammar: lesson.objectives.grammar,
      lessonOrder: lesson.order,
      rev: lesson.rev,
      ...(lesson.framingStale ? { refresh: true } : {}),
    },
    onState,
  );
  if (framing) {
    await saveLesson(lesson.id, framing, lesson.rev, lesson);
    lesson.framing = framing;
    lesson.framingStale = false;
  }
  return framing;
}

// Révision (leçons précédentes) mélangée aux histoires — dosage léger, pondéré plus bas que
// les cibles de la leçon courante. Tirage aléatoire à chaque variante pour éviter qu'un même
// thème (ex. un mot vu en leçon 1) ne revienne systématiquement.
const REVIEW_VOCAB_COUNT = 6;
const REVIEW_GRAMMAR_COUNT = 2;
const AVOID_TITLES_MAX = 5;

/** Prochaine variante d'histoire non encore matérialisée : max(local ∪ distant) + 1. */
export function nextStoryVariant(lesson: Lesson): number {
  const localMax = Math.max(0, ...lesson.stories.map((s) => s.variant ?? 0));
  const remoteMax = Math.max(0, ...lesson.remoteStoryVariants);
  return Math.max(localMax, remoteMax) + 1;
}

/**
 * Génère (et sauve) une nouvelle histoire pour la leçon.
 * `variant` : numéro de variante explicite (pour ouvrir une variante distante précise) ou
 * auto-calculé = prochaine variante non encore matérialisée.
 */
export async function addLessonStory(
  lesson: Lesson,
  variant?: number,
  onState?: (s: GenState) => void,
): Promise<StoryRecord> {
  const resolvedVariant = variant ?? nextStoryVariant(lesson);

  // Révision : union des acquis des leçons précédentes, moins les cibles de la leçon courante.
  const cumulative = getCumulativeObjectives(lesson.id);
  const currentVocabKeys = new Set(lesson.objectives.vocab.map((v) => v.ja + "|" + (v.yomi ?? "")));
  const currentGrammarKeys = new Set(lesson.objectives.grammar);
  const reviewVocabPool = cumulative.vocab.filter((v) => !currentVocabKeys.has(v.ja + "|" + (v.yomi ?? "")));
  const reviewGrammarPool = cumulative.grammar.filter((g) => !currentGrammarKeys.has(g));

  const reviewVocab = sample(reviewVocabPool, REVIEW_VOCAB_COUNT);
  const reviewGrammar = sample(reviewGrammarPool, REVIEW_GRAMMAR_COUNT);
  const avoidTitles = lesson.stories
    .map((s) => (s.titleFr ? `${s.title} (${s.titleFr})` : s.title))
    .filter(Boolean)
    .slice(-AVOID_TITLES_MAX);

  const { text, image } = await generateLessonStory(
    {
      lessonId: lesson.id,
      title: lesson.title,
      level: lesson.level,
      vocab: lesson.objectives.vocab,
      grammar: lesson.objectives.grammar,
      reviewVocab,
      reviewGrammar,
      avoidTitles,
    },
    resolvedVariant,
    onState,
  );
  if (!text.trim()) throw new Error("Histoire vide reçue.");
  return saveStory(
    text,
    {
      level: lesson.level,
      grammar: lesson.objectives.grammar.length ? lesson.objectives.grammar : undefined,
    },
    lesson.id,
    resolvedVariant,
    image,
  );
}
