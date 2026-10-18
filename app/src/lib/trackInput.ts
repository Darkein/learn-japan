// Ce que l'app sait (leçons, activité suivante, tampons) → l'entrée de la voie (lib/track.ts).
// Pur : l'accueil fait les lectures, ce module ne fait que traduire.

import { ROUTES } from "../data/routes";
import type { FlowActivity } from "./flow";
import { SCENERIES } from "../data/scenery";
import { reliefOf, reserveOf, type RouteScenery } from "./scenery";
import { nextStep, stepNumberBases, type PathStep } from "./path";
import type { TrackCity, TrackCurrent, TrackInput, TrackLesson, TrackRoute } from "./track";

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
 * Les routes telles que la voie les dessine. Les données de décor (data/scenery) donnent, ville
 * par ville, la taille, la lecture, le motif du tampon, le relief et les places réservées ; à
 * défaut, le départ et le terminus sont des terminus, les jalons (`city`) de grandes villes, les
 * autres des villes-étapes.
 */
export function trackRoutes(sceneries: RouteScenery[] = SCENERIES): TrackRoute[] {
  return ROUTES.map((r) => {
    const scenery = sceneries.find((s) => s.level === r.level);
    return {
      level: r.level,
      reserve: reserveOf(scenery),
      relief: reliefOf(scenery),
      cities: r.stations.map((s, i): TrackCity => {
        const d = scenery?.cities[s.index];
        return {
          index: s.index,
          kanji: s.kanji,
          romaji: s.romaji,
          size: d?.size ?? (i === 0 || i === r.stations.length - 1 ? "terminus" : s.city ? "grande" : "ville"),
          ...(d?.kana ? { kana: d.kana } : {}),
          ...(d?.motif ? { motif: d.motif } : {}),
          ...(d?.glyph ? { glyph: d.glyph } : {}),
        };
      }),
    };
  });
}

let defaultRoutes: TrackRoute[] | null = null;

/** Une ville d'une route, telle que la voie la dessine (taille, kanji du nœud, motif). */
export function cityOf(level: number, index: number): TrackCity | undefined {
  defaultRoutes ??= trackRoutes();
  return defaultRoutes.find((r) => r.level === level)?.cities[index];
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
  /** Le décor des routes (data/scenery par défaut). */
  sceneries?: RouteScenery[];
}): TrackInput {
  const { width, lessons, activity, stamps, restDone, sceneries } = args;
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
    routes: trackRoutes(sceneries),
    current: trackCurrent(activity, lessons),
    stamps,
    bases: stepNumberBases(lessons),
  };
}
