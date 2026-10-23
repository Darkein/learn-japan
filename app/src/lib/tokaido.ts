// Voyage sur les routes du Japon (SPEC §5c.4) : UNE ROUTE PAR NIVEAU JLPT (voir
// data/routes.ts) — le Tōkaidō pour N5, puis le voyageur repart de zéro sur le Kōshū Kaidō
// (N4), le Nakasendō (N3)…
//
// La route ACTIVE est celle du premier niveau (5 → 1) dont les leçons ne sont pas toutes
// terminées. La position sur la route est le NOMBRE D'ÉTAPES FAITES dans le niveau : les
// villes sont fixées par étape (`stationStep`), le train avance d'une étape à la suivante.
// Ni la maîtrise ni les bonus (contrôle, omikuji) ne le font bouger : il ne recule donc
// jamais, par construction. Toutes les leçons du niveau terminées → la route est faite
// (position = terme), et la route suivante commence.

import { ROUTES, routeForLevel, type Route } from "../data/routes";
import type { TokaidoStation } from "../data/tokaido";
import { getMeta, putMeta } from "./db";

/** Ce que le calcul attend d'une leçon — sous-ensemble de lessons.ts `Lesson`. */
export interface TokaidoLessonLike {
  level: number; // niveau JLPT (5 = N5 … 1 = N1)
  completedAt?: number;
  /** Étapes du parcours de la leçon, et celles déjà faites. */
  steps: string[];
  stepsDone: string[];
}

export interface TokaidoLevelStat {
  level: number;
  lessonsTotal: number;
  lessonsCompleted: number;
  /** Étapes du parcours de toutes les leçons du niveau. */
  stepsTotal: number;
  /** Étapes faites (une leçon terminée compte pour toutes ses étapes). */
  stepsDone: number;
}

export interface TokaidoPosition {
  route: Route;
  /** 0..span (span = stations.length - 1), flottant : ville atteinte + part du tronçon. */
  position: number;
  /** Dernière ville atteinte. */
  station: TokaidoStation;
  next?: TokaidoStation;
  /** Progression vers la ville suivante, 0..100. */
  betweenPct: number;
  /** Étapes faites dans le niveau, sur son total. */
  stepsDone: number;
  stepsTotal: number;
  /** Étapes qui restent jusqu'à la ville suivante (absent au terme). */
  stepsToNext?: number;
}

/** Agrège les leçons par niveau JLPT (pur). */
export function levelStatsFromLessons(lessons: TokaidoLessonLike[]): TokaidoLevelStat[] {
  const byLevel = new Map<number, TokaidoLevelStat>();
  for (const l of lessons) {
    const stat =
      byLevel.get(l.level) ??
      { level: l.level, lessonsTotal: 0, lessonsCompleted: 0, stepsTotal: 0, stepsDone: 0 };
    stat.lessonsTotal++;
    stat.stepsTotal += l.steps.length;
    if (l.completedAt) {
      stat.lessonsCompleted++;
      stat.stepsDone += l.steps.length;
    } else {
      // Le contrôle termine la leçon : tant qu'elle ne l'est pas, sa dernière étape reste à faire.
      stat.stepsDone += Math.min(l.stepsDone.length, l.steps.length - 1);
    }
    byLevel.set(l.level, stat);
  }
  return [...byLevel.values()].sort((a, b) => b.level - a.level);
}

/** Un niveau est achevé quand toutes ses leçons sont terminées. */
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

/**
 * Étape du niveau (comptée de 1 à `stepsTotal`) à la fin de laquelle la ville `k` est
 * atteinte (pur, SPEC §5c.4). La ville 0 est le départ ; la dernière tombe sur la dernière
 * étape (le contrôle final), aucune avant la première. Un niveau sans étapes laisse toutes
 * les villes à 0.
 */
export function stationStep(k: number, stepsTotal: number, span: number): number {
  if (k <= 0 || span <= 0 || stepsTotal <= 0) return 0;
  // Au moins une étape : aucune ville n'est « atteinte » sans avoir quitté le départ.
  return Math.max(1, Math.round((Math.min(k, span) * stepsTotal) / span));
}

/** Dernière ville atteinte après `stepsDone` étapes (pur). */
function stationReached(stepsDone: number, stepsTotal: number, span: number): number {
  if (stepsTotal <= 0) return 0;
  let k = 0;
  while (k < span && stationStep(k + 1, stepsTotal, span) <= stepsDone) k++;
  return k;
}

/** Position sur la route active (pur). */
export function computeTokaidoPosition(levels: TokaidoLevelStat[]): TokaidoPosition {
  const route = routeForLevel(activeLevel(levels));
  const span = route.stations.length - 1;
  const stat = levels.find((s) => s.level === route.level);
  const stepsTotal = stat?.stepsTotal ?? 0;
  const stepsDone = levelDone(stat) ? stepsTotal : Math.min(stat?.stepsDone ?? 0, stepsTotal);
  const floor = levelDone(stat) ? span : stationReached(stepsDone, stepsTotal, span);
  const next = floor < span ? route.stations[floor + 1] : undefined;
  let frac = 0;
  let stepsToNext: number | undefined;
  if (next) {
    const from = stationStep(floor, stepsTotal, span);
    const to = stationStep(floor + 1, stepsTotal, span);
    frac = to > from ? (stepsDone - from) / (to - from) : 0;
    stepsToNext = stepsTotal > 0 ? to - stepsDone : undefined;
  }
  return {
    route,
    position: floor + frac,
    station: route.stations[floor],
    next,
    betweenPct: next ? Math.round(frac * 100) : 100,
    stepsDone,
    stepsTotal,
    stepsToNext,
  };
}

// ---- IO (meta) ---------------------------------------------------------------

export interface RouteArrival {
  route: Route;
  /** La dernière ville franchie, celle que la fiche montre. */
  station: TokaidoStation;
  /** Les villes franchies avant elle d'un même trajet, citées par la fiche (§5c.5). */
  others: TokaidoStation[];
  /** Les chiffres du niveau, pour la célébration du terminus (§5c.7). */
  totals: { steps: number; lessons: number };
}

export interface TokaidoStatus {
  pos: TokaidoPosition;
  levels: TokaidoLevelStat[];
  /** Ville franchie depuis la dernière célébration (à fêter, puis markStationCelebrated). */
  newlyArrived?: RouteArrival;
  /** Tampons de ville récoltés par niveau (villes 1..k ; le départ n'en donne pas). */
  stamps: Record<number, number>;
}

/**
 * Migration de l'ancien schéma (une seule route, segments de 11 points par niveau) vers
 * les clés par niveau : la dernière station fêtée de l'ancien segment devient la station
 * de même fraction sur la route du même niveau. Elle reste acquise (tampons, §5c.4).
 */
async function migrateLegacyMeta(): Promise<void> {
  if (await getMeta<boolean>("tokaido.routesMigrated")) return;
  const legacyCelebrated = (await getMeta<number>("tokaido.lastCelebrated")) ?? 0;
  for (const r of ROUTES) {
    const start = (5 - r.level) * 11;
    const segment = r.level === 1 ? 10 : 11;
    const span = r.stations.length - 1;
    const frac = Math.min(1, Math.max(0, (legacyCelebrated - start) / segment));
    if (frac > 0) await putMeta(`tokaido.lastCelebrated.${r.level}`, Math.floor(frac * span));
  }
  await putMeta("tokaido.routesMigrated", true);
}

/**
 * Position courante, arrivée éventuelle et tampons. Prend les leçons en argument pour
 * réutiliser le listLessons() que l'appelant (Home, FlowSession) a déjà payé.
 */
export async function tokaidoStatus(lessons: TokaidoLessonLike[]): Promise<TokaidoStatus> {
  await migrateLegacyMeta();
  const levels = levelStatsFromLessons(lessons);
  const pos = computeTokaidoPosition(levels);
  const level = pos.route.level;
  const celebrated: Record<number, number> = {};
  for (const r of ROUTES) celebrated[r.level] = (await getMeta<number>(`tokaido.lastCelebrated.${r.level}`)) ?? 0;

  const stamps: Record<number, number> = {};
  for (const r of ROUTES) {
    const span = r.stations.length - 1;
    // Une route d'un niveau déjà achevé est entière ; la route active compte ses villes
    // atteintes, ou celles déjà fêtées par l'ancien calcul si elles vont plus loin.
    stamps[r.level] =
      r.level > level ? span : r.level === level ? Math.max(Math.floor(pos.position), celebrated[r.level]) : celebrated[r.level];
  }

  // Un terme de route achevée pas encore fêté prime (l'arrivée à Kyōto ne se rate pas).
  for (const r of ROUTES) {
    if (r.level === level) break;
    const span = r.stations.length - 1;
    if (celebrated[r.level] < span) {
      const others = r.stations.slice(celebrated[r.level] + 1, span).filter((s) => s.index >= 1);
      const stat = levels.find((s) => s.level === r.level);
      const totals = { steps: stat?.stepsTotal ?? 0, lessons: stat?.lessonsTotal ?? 0 };
      return { pos, levels, stamps, newlyArrived: { route: r, station: r.stations[span], others, totals } };
    }
  }
  const floor = Math.floor(pos.position);
  // On ne fête que la dernière ville franchie (pas de rafale après une longue absence).
  const newlyArrived =
    floor > celebrated[level] && floor >= 1
      ? {
          route: pos.route,
          station: pos.route.stations[floor],
          others: pos.route.stations.slice(Math.max(1, celebrated[level] + 1), floor),
          totals: { steps: pos.stepsTotal, lessons: levels.find((s) => s.level === level)?.lessonsTotal ?? 0 },
        }
      : undefined;
  return { pos, levels, stamps, newlyArrived };
}

/** Total des tampons de ville, toutes routes (compteur 印 de l'en-tête). */
export function stampTotal(stamps: Record<number, number>): number {
  return Object.values(stamps).reduce((a, b) => a + b, 0);
}

export async function markStationCelebrated(level: number, index: number): Promise<void> {
  const prev = (await getMeta<number>(`tokaido.lastCelebrated.${level}`)) ?? 0;
  await putMeta(`tokaido.lastCelebrated.${level}`, Math.max(prev, index));
}

// ---- Tampons de fortune (omikuji, §5c.5) ---------------------------------------

export interface FortuneStamp {
  /** Jour du tirage (YYYY-MM-DD local). */
  date: string;
  /** Identifiant de la fortune (lib/omikuji.ts FORTUNES). */
  fortune: string;
}

const FORTUNE_STAMPS = "stamps.fortune";

/** Ajoute le tampon de fortune du jour au carnet — un par jour au plus (idempotent). */
export async function addFortuneStamp(stamp: FortuneStamp): Promise<void> {
  const prev = (await getMeta<FortuneStamp[]>(FORTUNE_STAMPS)) ?? [];
  if (prev.some((s) => s.date === stamp.date)) return;
  await putMeta(FORTUNE_STAMPS, [...prev, stamp]);
}

export async function fortuneStamps(): Promise<FortuneStamp[]> {
  return (await getMeta<FortuneStamp[]>(FORTUNE_STAMPS)) ?? [];
}
