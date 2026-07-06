// Voyage sur le Tōkaidō : la progression réelle (leçons terminées + maîtrise FSRS) fait
// avancer le voyageur d'Edo (Nihonbashi) vers Kyōto (Sanjō Ōhashi) — 55 points, voir
// data/tokaido.ts. Remplace toute notion d'XP abstrait.
//
// Formule ANCRÉE PAR NIVEAU JLPT, stable quand le curriculum grandit : chaque niveau
// possède un segment fixe de la route (N5 : 0→11, N4 : 11→22, N3 : 22→33, N2 : 33→44,
// N1 : 44→54). Ajouter des leçons N4+ au curriculum ne fait donc jamais reculer la
// position d'un utilisateur N5 ; ajouter des leçons DANS un niveau dilue la progression
// intra-segment, ce que compense la monotonie persistée (meta "tokaido.maxReached" :
// on ne recule jamais).

import { TOKAIDO, type TokaidoStation } from "../data/tokaido";
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
  /** Position max déjà atteinte (meta "tokaido.maxReached") — jamais de recul. */
  maxReached: number;
}

export interface TokaidoPosition {
  /** 0..54, flottant. */
  position: number;
  /** Dernière station atteinte (floor de la position). */
  station: TokaidoStation;
  next?: TokaidoStation;
  /** Progression vers la station suivante, 0..100. */
  betweenPct: number;
}

const END = TOKAIDO.length - 1; // 54
/** Longueur du segment d'un niveau : 11 points, 10 pour N1 (l'arrivée est le point 54).
 * Le début du segment (N5 → 0, N4 → 11, …) est implicite : les contributions s'additionnent. */
function segmentSpan(level: number): number {
  return level === 1 ? 10 : 11;
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

/**
 * Position sur la route (pur). Chaque niveau contribue à son propre segment :
 * progression = 0.6 × (leçons terminées) + 0.4 × (items maîtrisés). Les contributions
 * s'additionnent (on peut entamer N4 sans avoir 100 % de maîtrise N5).
 */
export function computeTokaidoPosition(input: TokaidoInput): TokaidoPosition {
  let raw = 0;
  for (const s of input.levels) {
    const lessonsFrac = s.lessonsTotal === 0 ? 0 : s.lessonsCompleted / s.lessonsTotal;
    const masteryFrac = s.itemsTotal === 0 ? 0 : s.itemsMastered / s.itemsTotal;
    raw += segmentSpan(s.level) * (0.6 * lessonsFrac + 0.4 * masteryFrac);
  }
  const position = Math.min(END, Math.max(raw + input.bonus, input.maxReached));
  const floor = Math.min(END, Math.floor(position));
  return {
    position,
    station: TOKAIDO[floor],
    next: floor < END ? TOKAIDO[floor + 1] : undefined,
    betweenPct: floor >= END ? 100 : Math.round((position - floor) * 100),
  };
}

/**
 * Estimation grossière du nombre de leçons restantes pour atteindre la prochaine station
 * (pur) — « Encore ~2 leçons pour atteindre Kawasaki ». On suppose que la maîtrise suit
 * les leçons : chaque leçon terminée vaut ~span/lessonsTotal points.
 */
export function estimateLessonsToNext(pos: TokaidoPosition, levels: TokaidoLevelStat[]): number | undefined {
  if (!pos.next) return undefined;
  const level = 5 - Math.floor(pos.position / 11);
  const stat = levels.find((s) => s.level === level);
  if (!stat || stat.lessonsTotal === 0) return undefined;
  const pointsPerLesson = segmentSpan(level) / stat.lessonsTotal;
  return Math.max(1, Math.ceil((pos.next.index - pos.position) / pointsPerLesson));
}

// ---- IO (meta) ---------------------------------------------------------------

export interface TokaidoStatus {
  pos: TokaidoPosition;
  levels: TokaidoLevelStat[];
  /** Station franchie depuis la dernière célébration (à fêter, puis markStationCelebrated). */
  newlyArrived?: TokaidoStation;
}

/**
 * Position courante + arrivée éventuelle. Prend les leçons en argument pour réutiliser le
 * listLessons() que l'appelant (Home, checkpoint) a déjà payé. Persiste la monotonie.
 */
export async function tokaidoStatus(lessons: TokaidoLessonLike[]): Promise<TokaidoStatus> {
  const levels = levelStatsFromLessons(lessons);
  const [bonus, maxReached, lastCelebrated] = await Promise.all([
    getMeta<number>("tokaido.bonus"),
    getMeta<number>("tokaido.maxReached"),
    getMeta<number>("tokaido.lastCelebrated"),
  ]);
  const pos = computeTokaidoPosition({ levels, bonus: bonus ?? 0, maxReached: maxReached ?? 0 });
  if (pos.position > (maxReached ?? 0)) {
    await putMeta("tokaido.maxReached", pos.position);
  }
  const floor = Math.floor(pos.position);
  const celebrated = lastCelebrated ?? 0;
  // On ne fête que la dernière station franchie (pas de rafale après une longue absence).
  const newlyArrived = floor > celebrated && floor >= 1 ? TOKAIDO[floor] : undefined;
  return { pos, levels, newlyArrived };
}

export async function markStationCelebrated(index: number): Promise<void> {
  const prev = (await getMeta<number>("tokaido.lastCelebrated")) ?? 0;
  await putMeta("tokaido.lastCelebrated", Math.max(prev, index));
}

/** Bonus omikuji : fraction de station gagnée (clampée à [0, 1] par appel). */
export async function addTokaidoBonus(fraction: number): Promise<void> {
  const clamped = Math.min(1, Math.max(0, fraction));
  const prev = (await getMeta<number>("tokaido.bonus")) ?? 0;
  await putMeta("tokaido.bonus", prev + clamped);
}
