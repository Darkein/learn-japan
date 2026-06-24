// Curriculum + leçons : fusionne le plan statique (curriculum.json) avec le
// contenu généré et la progression locale (IndexedDB).
//
// Une « leçon » est :
// - prête  : intro + storyJa disponibles (via seed ou via génération antérieure).
// - à générer : seulement les objectifs sont définis ; l'utilisateur peut lancer la génération.
// - terminée : marquée lue ; n'empêche pas de la relire.

import curriculumData from "../data/curriculum.json";
import { resolveGrammar, resolveKanji, resolveVocab } from "./inventory";
import { seedFraming } from "./seedContent";
import {
  allLessonProgress,
  getGeneratedLesson,
  getLessonProgress,
  putGeneratedLesson,
  putLessonProgress,
  storiesForLesson,
  type GeneratedLessonRecord,
  type LessonProgressRecord,
  type StoryRecord,
} from "./db";

export interface VocabEntry {
  ja: string;
  /** Lecture en hiragana (absente si `ja` est déjà entièrement en kana). */
  yomi?: string;
  fr: string;
}

export interface KanjiEntry {
  ja: string;
  fr: string;
}

export interface LessonObjectives {
  vocab: VocabEntry[];
  kanji: KanjiEntry[];
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

/** Une leçon est « prête » dès qu'elle a au moins une histoire à lire. */
export type LessonState = "ready" | "to-generate";

export interface Lesson extends CurriculumEntry {
  state: LessonState;
  /** Cadrage rédigé/généré du cours (Markdown), complète le cours assemblé depuis l'inventaire. */
  framing?: string;
  framingSource?: "seed" | "generated";
  /** Histoires rattachées (seed matérialisé + générées), via le pipeline `stories`. */
  stories: StoryRecord[];
  completedAt?: number;
  startedAt?: number;
}

// ---- Curriculum v3 : niveau → unité → leçon, avec références à l'inventaire ----

export interface Introduces {
  vocab: string[];
  kanji: string[];
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
    kanji: intro.kanji.map(resolveKanji),
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
  if (!target) return { vocab: [], kanji: [], grammar: [] };
  const seen = CURRICULUM.filter(
    (c) => c.level > target.level || (c.level === target.level && c.order <= target.order),
  );
  const vocab = new Map<string, VocabEntry>();
  const kanji = new Map<string, KanjiEntry>();
  const grammar = new Set<string>();
  for (const c of seen) {
    for (const v of c.objectives.vocab) vocab.set(v.ja + "|" + (v.yomi ?? ""), v);
    for (const k of c.objectives.kanji) kanji.set(k.ja, k);
    for (const g of c.objectives.grammar) grammar.add(g);
  }
  return { vocab: [...vocab.values()], kanji: [...kanji.values()], grammar: [...grammar] };
}

async function hydrate(entry: CurriculumEntry): Promise<Lesson> {
  const [generated, progress, stories] = await Promise.all([
    getGeneratedLesson(entry.id),
    getLessonProgress(entry.id),
    storiesForLesson(entry.id),
  ]);
  // Cadrage : la prose rédigée (seed Markdown) prime, sinon le cadrage généré en cache.
  const seeded = seedFraming(entry.id);
  const framing = seeded ?? generated?.intro;
  const framingSource: Lesson["framingSource"] = seeded
    ? "seed"
    : generated
      ? "generated"
      : undefined;
  return {
    ...entry,
    // Prête à lire dès qu'il existe au moins une histoire (seed matérialisé ou générée).
    state: stories.length > 0 ? "ready" : "to-generate",
    framing,
    framingSource,
    stories,
    completedAt: progress?.completedAt,
    startedAt: progress?.startedAt,
  };
}

export async function listLessons(): Promise<Lesson[]> {
  return Promise.all(CURRICULUM.map(hydrate));
}

export async function getLesson(id: string): Promise<Lesson | undefined> {
  const entry = getCurriculumEntry(id);
  if (!entry) return undefined;
  return hydrate(entry);
}

/** Met en cache le cadrage de cours généré (les histoires, elles, passent par `saveStory`). */
export async function saveLessonIntro(id: string, intro: string): Promise<GeneratedLessonRecord> {
  const rec: GeneratedLessonRecord = { id, intro, createdAt: Date.now() };
  await putGeneratedLesson(rec);
  return rec;
}

export async function markLessonStarted(id: string): Promise<void> {
  const prev = (await getLessonProgress(id)) ?? { id };
  const next: LessonProgressRecord = { ...prev, startedAt: prev.startedAt ?? Date.now() };
  await putLessonProgress(next);
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
