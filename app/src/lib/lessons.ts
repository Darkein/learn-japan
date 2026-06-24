// Curriculum + leçons : fusionne le plan statique (curriculum.json) avec le
// contenu généré et la progression locale (IndexedDB).
//
// Une « leçon » est :
// - prête  : intro + storyJa disponibles (via seed ou via génération antérieure).
// - à générer : seulement les objectifs sont définis ; l'utilisateur peut lancer la génération.
// - terminée : marquée lue ; n'empêche pas de la relire.

import curriculumData from "../data/curriculum.json";
import {
  allLessonProgress,
  getGeneratedLesson,
  getLessonProgress,
  putGeneratedLesson,
  putLessonProgress,
  type GeneratedLessonRecord,
  type LessonProgressRecord,
} from "./db";

export interface LessonObjectives {
  vocab: string[];
  kanji: string[];
  grammar: string[];
}

export interface CurriculumEntry {
  id: string;
  order: number;
  level: number;
  title: string;
  summary?: string;
  objectives: LessonObjectives;
  seed?: { intro: string; storyJa: string };
}

export type LessonState = "ready" | "to-generate";

export interface Lesson extends CurriculumEntry {
  state: LessonState;
  intro?: string;
  storyJa?: string;
  /** "seed" si rédigé à la main, "generated" si produit par le LLM. */
  source?: "seed" | "generated";
  completedAt?: number;
  startedAt?: number;
}

interface CurriculumFile {
  version: number;
  lessons: CurriculumEntry[];
}

const CURRICULUM = (curriculumData as CurriculumFile).lessons
  .slice()
  .sort((a, b) => a.order - b.order);

export function getCurriculum(): CurriculumEntry[] {
  return CURRICULUM;
}

export function getCurriculumEntry(id: string): CurriculumEntry | undefined {
  return CURRICULUM.find((c) => c.id === id);
}

async function hydrate(entry: CurriculumEntry): Promise<Lesson> {
  const [generated, progress] = await Promise.all([
    getGeneratedLesson(entry.id),
    getLessonProgress(entry.id),
  ]);
  if (entry.seed) {
    return {
      ...entry,
      state: "ready",
      intro: entry.seed.intro,
      storyJa: entry.seed.storyJa,
      source: "seed",
      completedAt: progress?.completedAt,
      startedAt: progress?.startedAt,
    };
  }
  if (generated) {
    return {
      ...entry,
      state: "ready",
      intro: generated.intro,
      storyJa: generated.storyJa,
      source: "generated",
      completedAt: progress?.completedAt,
      startedAt: progress?.startedAt,
    };
  }
  return {
    ...entry,
    state: "to-generate",
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

export async function saveGeneratedLesson(
  id: string,
  payload: { intro: string; storyJa: string },
): Promise<GeneratedLessonRecord> {
  const rec: GeneratedLessonRecord = {
    id,
    intro: payload.intro,
    storyJa: payload.storyJa,
    createdAt: Date.now(),
  };
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
