// Ce que l'app sait (leçons, activité suivante, tampons) → l'entrée de la voie (lib/track.ts).
// Pur : l'accueil fait les lectures, ce module ne fait que traduire.

import { ROUTES } from "../data/routes";
import type { FlowActivity } from "./flow";
import { nextStep, stepNumberBases, type PathStep } from "./path";
import type { CitySize, TrackCurrent, TrackInput, TrackLesson, TrackRoute } from "./track";

/** Ce que la voie lit d'une leçon — sous-ensemble de lessons.ts `Lesson`. */
export interface TrackLessonSource {
  id: string;
  level: number;
  order: number;
  title: string;
  introduces: { vocab: string[]; grammar: string[] };
  steps: PathStep[];
  stepsDone: PathStep[];
  completedAt?: number;
  startedAt?: number;
  locked: boolean;
}

/**
 * Taille d'une ville (SPEC §5c.4). Les données de décor de chaque route la donnent ville par
 * ville ; à défaut, le départ et le terminus sont des terminus, les jalons (`city`) de grandes
 * villes, les autres des villes.
 */
export type CitySizeOf = (level: number, index: number) => CitySize | undefined;

export function trackRoutes(sizeOf: CitySizeOf = () => undefined): TrackRoute[] {
  return ROUTES.map((r) => ({
    level: r.level,
    cities: r.stations.map((s, i) => ({
      index: s.index,
      kanji: s.kanji,
      romaji: s.romaji,
      size:
        sizeOf(r.level, s.index) ??
        (i === 0 || i === r.stations.length - 1 ? "terminus" : s.city ? "grande" : "ville"),
    })),
  }));
}

/** L'activité suivante du flux, traduite en nœud de la voie. */
export function trackCurrent(activity: FlowActivity | undefined, lessons: TrackLessonSource[]): TrackCurrent | undefined {
  if (!activity) return undefined;
  const lesson = activity.lessonId ? lessons.find((l) => l.id === activity.lessonId) : undefined;
  const upcoming = lesson ? nextStep(lesson.steps, new Set(lesson.stepsDone)) : undefined;
  switch (activity.kind) {
    case "review":
      if (!lesson) return { kind: "free-review" };
      if (activity.step === "review") return { kind: "step", lessonId: lesson.id, step: "review" };
      if (!upcoming) return undefined;
      return { kind: activity.itemIds ? "targeted-review" : "inserted-review", lessonId: lesson.id, step: upcoming };
    case "rest": {
      const last = activity.lessonIds?.[activity.lessonIds.length - 1];
      return last ? { kind: "rest", lessonId: last } : undefined;
    }
    case "mirror":
    case "done":
      return undefined;
    default:
      return lesson && activity.step ? { kind: "step", lessonId: lesson.id, step: activity.step } : undefined;
  }
}

export function trackInput(args: {
  width: number;
  lessons: TrackLessonSource[];
  activity?: FlowActivity;
  stamps: Record<number, number>;
  /** Leçons dont la station de repos qui les suit est faite. */
  restDone: Set<string>;
  sizeOf?: CitySizeOf;
}): TrackInput {
  const { width, lessons, activity, stamps, restDone, sizeOf } = args;
  const firstOpen = lessons.find((l) => !l.completedAt && !l.locked);
  const track: TrackLesson[] = lessons.map((l) => ({
    id: l.id,
    level: l.level,
    number: l.order,
    title: l.title,
    steps: l.steps,
    stepsDone: l.stepsDone,
    completed: !!l.completedAt,
    open: !!l.startedAt || l === firstOpen,
    restDone: restDone.has(l.id),
  }));
  return {
    width,
    lessons: track,
    routes: trackRoutes(sizeOf),
    current: trackCurrent(activity, lessons),
    stamps,
    bases: stepNumberBases(lessons),
  };
}
