// Voyage sur les routes du Japon : la progression réelle (leçons terminées + maîtrise FSRS)
// fait avancer le voyageur. UNE ROUTE PAR NIVEAU JLPT (voir data/routes.ts) : le Tōkaidō
// pour N5, puis le voyageur repart de zéro sur le Kōshū Kaidō (N4), le Nakasendō (N3)…
// La longueur de chaque route suit le volume de son niveau, la cadence des étapes reste
// donc comparable d'un niveau à l'autre.
//
// La route ACTIVE est celle du premier niveau (5 → 1) dont les leçons ne sont pas toutes
// terminées. Position sur la route active = span × (0.6 × leçons + 0.4 × maîtrise) ;
// toutes les leçons terminées → la route est faite (position = terme), quelle que soit la
// maîtrise, et la route suivante commence. Monotonie persistée PAR NIVEAU
// (meta "tokaido.maxReached.<niveau>") : on ne recule jamais sur une route.

import { ROUTES, routeForLevel, type Route } from "../data/routes";
import type { TokaidoStation } from "../data/tokaido";
import { getMeta, putMeta } from "./db";

/** Ce que la formule attend d'une leçon — sous-ensemble de lessons.ts `Lesson`. */
export interface TokaidoLessonLike {
  level: number; // niveau JLPT (5 = N5 … 1 = N1)
  completedAt?: number;
  /** Part des items de la leçon maîtrisés (0..1), déjà calculée par listLessons. */
  mastery: number;
  introduces: { vocab: string[]; grammar: string[] };
}

export interface TokaidoLevelStat {
  level: number;
  lessonsTotal: number;
  lessonsCompleted: number;
  itemsTotal: number;
  itemsMastered: number;
}

export interface TokaidoInput {
  levels: TokaidoLevelStat[];
  /** Bonus omikuji cumulé (fraction de station), meta "tokaido.bonus". */
  bonus: number;
  /** Position max déjà atteinte sur la route ACTIVE (meta "tokaido.maxReached.<niveau>"). */
  maxReached: number;
}

export interface TokaidoPosition {
  route: Route;
  /** 0..span (span = stations.length - 1), flottant. */
  position: number;
  /** Dernière station atteinte (floor de la position). */
  station: TokaidoStation;
  next?: TokaidoStation;
  /** Progression vers la station suivante, 0..100. */
  betweenPct: number;
}

/** Agrège les leçons par niveau JLPT pour la formule (pur). */
export function levelStatsFromLessons(lessons: TokaidoLessonLike[]): TokaidoLevelStat[] {
  const byLevel = new Map<number, TokaidoLevelStat>();
  for (const l of lessons) {
    const stat =
      byLevel.get(l.level) ??
      { level: l.level, lessonsTotal: 0, lessonsCompleted: 0, itemsTotal: 0, itemsMastered: 0 };
    const items = l.introduces.vocab.length + l.introduces.grammar.length;
    stat.lessonsTotal++;
    if (l.completedAt) stat.lessonsCompleted++;
    stat.itemsTotal += items;
    stat.itemsMastered += l.mastery * items;
    byLevel.set(l.level, stat);
  }
  return [...byLevel.values()].sort((a, b) => b.level - a.level);
}

/** Un niveau est achevé quand toutes ses leçons sont terminées (la maîtrise, elle, fluctue). */
function levelDone(stat: TokaidoLevelStat | undefined): boolean {
  return !!stat && stat.lessonsTotal > 0 && stat.lessonsCompleted >= stat.lessonsTotal;
}

/** Niveau de la route active : premier niveau (5 → 1) non achevé. Tout fini → N1. */
export function activeLevel(levels: TokaidoLevelStat[]): number {
  for (const r of ROUTES) {
    if (!levelDone(levels.find((s) => s.level === r.level))) return r.level;
  }
  return 1;
}

/** Progression 0..1 sur la route d'un niveau : 60 % leçons, 40 % maîtrise ; 1 si achevé. */
function levelFrac(stat: TokaidoLevelStat | undefined): number {
  if (!stat || stat.lessonsTotal === 0) return 0;
  if (levelDone(stat)) return 1;
  const lessonsFrac = stat.lessonsCompleted / stat.lessonsTotal;
  const masteryFrac = stat.itemsTotal === 0 ? 0 : stat.itemsMastered / stat.itemsTotal;
  return 0.6 * lessonsFrac + 0.4 * masteryFrac;
}

/** Position sur la route active (pur). */
export function computeTokaidoPosition(input: TokaidoInput): TokaidoPosition {
  const route = routeForLevel(activeLevel(input.levels));
  const span = route.stations.length - 1;
  const raw = span * levelFrac(input.levels.find((s) => s.level === route.level));
  const position = Math.min(span, Math.max(raw + input.bonus, input.maxReached));
  const floor = Math.min(span, Math.floor(position));
  return {
    route,
    position,
    station: route.stations[floor],
    next: floor < span ? route.stations[floor + 1] : undefined,
    betweenPct: floor >= span ? 100 : Math.round((position - floor) * 100),
  };
}

/**
 * Estimation grossière du nombre de leçons restantes pour atteindre la prochaine station
 * (pur) — « Encore ~2 leçons pour atteindre Kawasaki ». On suppose que la maîtrise suit
 * les leçons : chaque leçon terminée vaut ~span/lessonsTotal points.
 */
export function estimateLessonsToNext(pos: TokaidoPosition, levels: TokaidoLevelStat[]): number | undefined {
  if (!pos.next) return undefined;
  const stat = levels.find((s) => s.level === pos.route.level);
  if (!stat || stat.lessonsTotal === 0) return undefined;
  const pointsPerLesson = (pos.route.stations.length - 1) / stat.lessonsTotal;
  return Math.max(1, Math.ceil((pos.next.index - pos.position) / pointsPerLesson));
}

// ---- IO (meta) ---------------------------------------------------------------

export interface RouteArrival {
  route: Route;
  station: TokaidoStation;
}

export interface TokaidoStatus {
  pos: TokaidoPosition;
  levels: TokaidoLevelStat[];
  /** Station franchie depuis la dernière célébration (à fêter, puis markStationCelebrated). */
  newlyArrived?: RouteArrival;
}

/**
 * Migration de l'ancien schéma (une seule route, segments de 11 points par niveau) vers
 * les clés par niveau : la fraction parcourue dans l'ancien segment devient la fraction
 * de la nouvelle route du même niveau.
 */
async function migrateLegacyMeta(): Promise<void> {
  if (await getMeta<boolean>("tokaido.routesMigrated")) return;
  const legacyMax = (await getMeta<number>("tokaido.maxReached")) ?? 0;
  const legacyCelebrated = (await getMeta<number>("tokaido.lastCelebrated")) ?? 0;
  for (const r of ROUTES) {
    const start = (5 - r.level) * 11;
    const segment = r.level === 1 ? 10 : 11;
    const span = r.stations.length - 1;
    const frac = (v: number) => Math.min(1, Math.max(0, (v - start) / segment));
    if (frac(legacyMax) > 0) await putMeta(`tokaido.maxReached.${r.level}`, frac(legacyMax) * span);
    if (frac(legacyCelebrated) > 0) {
      await putMeta(`tokaido.lastCelebrated.${r.level}`, Math.floor(frac(legacyCelebrated) * span));
    }
  }
  await putMeta("tokaido.routesMigrated", true);
}

/**
 * Position courante + arrivée éventuelle. Prend les leçons en argument pour réutiliser le
 * listLessons() que l'appelant (Home, checkpoint) a déjà payé. Persiste la monotonie.
 */
export async function tokaidoStatus(lessons: TokaidoLessonLike[]): Promise<TokaidoStatus> {
  await migrateLegacyMeta();
  const levels = levelStatsFromLessons(lessons);
  const level = activeLevel(levels);
  const [bonus, maxReached] = await Promise.all([
    getMeta<number>("tokaido.bonus"),
    getMeta<number>(`tokaido.maxReached.${level}`),
  ]);
  const pos = computeTokaidoPosition({ levels, bonus: bonus ?? 0, maxReached: maxReached ?? 0 });
  if (pos.position > (maxReached ?? 0)) {
    await putMeta(`tokaido.maxReached.${level}`, pos.position);
  }
  // Un terme de route achevée pas encore fêté prime (l'arrivée à Kyōto ne se rate pas).
  for (const r of ROUTES) {
    if (r.level === level) break;
    const span = r.stations.length - 1;
    const celebrated = (await getMeta<number>(`tokaido.lastCelebrated.${r.level}`)) ?? 0;
    if (celebrated < span) {
      return { pos, levels, newlyArrived: { route: r, station: r.stations[span] } };
    }
  }
  const floor = Math.floor(pos.position);
  const celebrated = (await getMeta<number>(`tokaido.lastCelebrated.${level}`)) ?? 0;
  // On ne fête que la dernière station franchie (pas de rafale après une longue absence).
  const newlyArrived =
    floor > celebrated && floor >= 1
      ? { route: pos.route, station: pos.route.stations[floor] }
      : undefined;
  return { pos, levels, newlyArrived };
}

export async function markStationCelebrated(level: number, index: number): Promise<void> {
  const prev = (await getMeta<number>(`tokaido.lastCelebrated.${level}`)) ?? 0;
  await putMeta(`tokaido.lastCelebrated.${level}`, Math.max(prev, index));
}

/** Bonus omikuji : fraction de station gagnée (clampée à [0, 1] par appel). */
export async function addTokaidoBonus(fraction: number): Promise<void> {
  const clamped = Math.min(1, Math.max(0, fraction));
  const prev = (await getMeta<number>("tokaido.bonus")) ?? 0;
  await putMeta("tokaido.bonus", prev + clamped);
}
