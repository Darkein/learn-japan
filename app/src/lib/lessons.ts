// Curriculum + leçons : fusionne le plan statique (curriculum.json) avec le
// contenu généré et la progression locale (IndexedDB).
//
// Une « leçon » est :
// - prête  : cours + histoire disponibles (via seed ou via génération antérieure).
// - à générer : seulement les objectifs sont définis ; l'utilisateur peut lancer la génération.
// - terminée : marquée lue ; n'empêche pas de la relire.

import curriculumData from "../data/curriculum.json";
import { fetchGenerated, generateLesson, generateLessonStory, type GeneratedIndex, type GenState } from "./genClient";
import { resolveGrammar, resolveVocab } from "./inventory";
import { saveStory } from "./stories";
import {
  allGrammar,
  allLessonProgress,
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
import { isMastered, isUnlockReady, type Card } from "./srs";
import { SRS } from "./config";

export interface VocabEntry {
  ja: string;
  /** Lecture en hiragana (absente si `ja` est déjà entièrement en kana). */
  yomi?: string;
  fr: string;
}

export interface LessonObjectives {
  vocab: VocabEntry[];
  grammar: string[];
}

export interface CurriculumEntry {
  id: string;
  order: number;
  level: number;
  title: string;
  summary?: string;
  /** Unité (chunk) à laquelle appartient la leçon. */
  unitId?: string;
  unitTitle?: string;
  objectives: LessonObjectives;
  /** Identifiants bruts vers l'inventaire (pour assembler le cours structuré). */
  introduces: Introduces;
}

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
}

// ---- Curriculum v3 : niveau → unité → leçon, avec références à l'inventaire ----

export interface Introduces {
  vocab: string[];
  grammar: string[];
}
interface RawLesson {
  id: string;
  order: number;
  title: string;
  summary?: string;
  introduces: Introduces;
}
interface RawUnit {
  id: string;
  title: string;
  lessons: RawLesson[];
}
interface RawLevel {
  level: number;
  units: RawUnit[];
}
interface CurriculumFileV3 {
  version: number;
  levels: RawLevel[];
}

/** Résout les identifiants `introduces` en objectifs affichables via l'inventaire. */
function resolveObjectives(intro: Introduces): LessonObjectives {
  return {
    vocab: intro.vocab.map(resolveVocab),
    grammar: intro.grammar.map(resolveGrammar),
  };
}

const CURRICULUM: CurriculumEntry[] = (curriculumData as CurriculumFileV3).levels
  .flatMap((lvl) =>
    lvl.units.flatMap((unit) =>
      unit.lessons.map(
        (l): CurriculumEntry => ({
          id: l.id,
          order: l.order,
          level: lvl.level,
          title: l.title,
          summary: l.summary,
          unitId: unit.id,
          unitTitle: unit.title,
          objectives: resolveObjectives(l.introduces),
          introduces: l.introduces,
        }),
      ),
    ),
  )
  .sort((a, b) => a.level !== b.level ? b.level - a.level : a.order - b.order);

export function getCurriculum(): CurriculumEntry[] {
  return CURRICULUM;
}

export function getCurriculumEntry(id: string): CurriculumEntry | undefined {
  return CURRICULUM.find((c) => c.id === id);
}

/**
 * Lexique cumulé connu à la leçon `id` : union des objectifs de toutes les leçons
 * déjà vues (niveau supérieur, ou même niveau d'ordre <= celui de la leçon). Sert à
 * contraindre la génération pour qu'une histoire n'emploie que du vocabulaire déjà introduit.
 */
export function getCumulativeObjectives(id: string): LessonObjectives {
  const target = getCurriculumEntry(id);
  if (!target) return { vocab: [], grammar: [] };
  const seen = CURRICULUM.filter(
    (c) => c.level > target.level || (c.level === target.level && c.order <= target.order),
  );
  const vocab = new Map<string, VocabEntry>();
  const grammar = new Set<string>();
  for (const c of seen) {
    for (const v of c.objectives.vocab) vocab.set(v.ja + "|" + (v.yomi ?? ""), v);
    for (const g of c.objectives.grammar) grammar.add(g);
  }
  return { vocab: [...vocab.values()], grammar: [...grammar] };
}

/** Leçons qui introduisent au moins une des règles de grammaire données (par id), triées par ordre. */
export function lessonsForGrammar(grammarIds: string[]): CurriculumEntry[] {
  if (grammarIds.length === 0) return [];
  const ids = new Set(grammarIds);
  return CURRICULUM.filter((c) => c.introduces.grammar.some((g) => ids.has(g))).sort(
    (a, b) => a.level !== b.level ? b.level - a.level : a.order - b.order,
  );
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
  const pregenerated = Boolean(remote?.cours && remote.stories.length > 0);
  const localVariants = new Set(stories.map((s) => s.variant).filter((v): v is number => v != null));
  const remoteStoryVariants = (remote?.stories ?? []).filter((v) => !localVariants.has(v)).sort((a, b) => a - b);

  return {
    ...entry,
    // Accessible (cours lisible) dès que le cadrage existe localement, qu'une histoire est
    // disponible (locale ou pré-générée distante). L'histoire peut alors se générer en
    // arrière-plan sans bloquer l'accès au cours.
    state: generated?.framing || stories.length > 0 || pregenerated ? "ready" : "to-generate",
    framing: generated?.framing,
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

export async function listLessons(): Promise<Lesson[]> {
  const remoteIndex = await loadGeneratedIndex();
  const [allVocabItems, allGrammarItems] = await Promise.all([
    allVocab(), allGrammar(),
  ]);
  const vocabMap = new Map(allVocabItems.map((v) => [v.id, v]));
  const grammarMap = new Map(allGrammarItems.map((g) => [g.id, g]));

  const lessons = await Promise.all(
    CURRICULUM.map((e) => hydrate(e, remoteIndex)),
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
  const [allVocabItems, allGrammarItems] = await Promise.all([
    allVocab(), allGrammar(),
  ]);
  const vocabMap = new Map(allVocabItems.map((v) => [v.id, v]));
  const grammarMap = new Map(allGrammarItems.map((g) => [g.id, g]));
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
export async function saveLesson(id: string, framing: string): Promise<GeneratedLessonRecord> {
  const rec: GeneratedLessonRecord = { id, framing, createdAt: Date.now() };
  await putGeneratedLesson(rec);
  return rec;
}

export async function markLessonStarted(id: string): Promise<void> {
  const prev = (await getLessonProgress(id)) ?? { id };
  const next: LessonProgressRecord = { ...prev, startedAt: prev.startedAt ?? Date.now() };
  await putLessonProgress(next);
  void enrollLesson(id);
}

export async function markLessonCompleted(id: string): Promise<void> {
  const prev = (await getLessonProgress(id)) ?? { id };
  const next: LessonProgressRecord = {
    ...prev,
    startedAt: prev.startedAt ?? Date.now(),
    completedAt: Date.now(),
  };
  await putLessonProgress(next);
}

export async function allProgress(): Promise<LessonProgressRecord[]> {
  return allLessonProgress();
}

// ---- Génération de contenu d'une leçon (partagée UI / podcast) --------------

/** S'assure que le cadrage du cours existe (le génère et le met en cache sinon). */
export async function ensureLessonFraming(
  lesson: Lesson,
  onState?: (s: GenState) => void,
): Promise<string | undefined> {
  if (lesson.framing) return lesson.framing;
  const framing = await generateLesson(
    {
      lessonId: lesson.id,
      title: lesson.title,
      level: lesson.level,
      vocab: lesson.objectives.vocab,
      grammar: lesson.objectives.grammar,
    },
    onState,
  );
  if (framing) {
    await saveLesson(lesson.id, framing);
    lesson.framing = framing;
  }
  return framing;
}

// Révision (leçons précédentes) mélangée aux histoires — dosage léger, pondéré plus bas que
// les cibles de la leçon courante. Tirage aléatoire à chaque variante pour éviter qu'un même
// thème (ex. un mot vu en leçon 1) ne revienne systématiquement.
const REVIEW_VOCAB_COUNT = 6;
const REVIEW_GRAMMAR_COUNT = 2;
const AVOID_TITLES_MAX = 5;

/** Tire `n` éléments au hasard dans `arr` (Fisher-Yates), sans dépasser sa taille. */
function sample<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * Génère (et sauve) une nouvelle histoire pour la leçon.
 * `variant` : numéro de variante explicite (pour ouvrir une variante distante précise) ou
 * auto-calculé = max(local ∪ distant) + 1 (prochaine variante non encore matérialisée).
 */
export async function addLessonStory(
  lesson: Lesson,
  variant?: number,
  onState?: (s: GenState) => void,
): Promise<StoryRecord> {
  // Calcul de la variante si non fournie : prochaine non matérialisée.
  const resolvedVariant = variant ?? (() => {
    const localMax = Math.max(0, ...lesson.stories.map((s) => s.variant ?? 0));
    const remoteMax = Math.max(0, ...lesson.remoteStoryVariants);
    return Math.max(localMax, remoteMax) + 1;
  })();

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

  const text = await generateLessonStory(
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
  );
}
