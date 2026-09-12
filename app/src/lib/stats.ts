// Statistiques d'apprentissage dérivées LOCALEMENT du log de révisions (append-only,
// store `reviews`) et des cartes FSRS — aucun LLM, aucun réseau. Fonctions pures
// (données en argument) → testables sans IndexedDB.

import { SRS } from "./config";
import {
  localDateString,
  RESET_GRADE,
  type ComprehensionItem,
  type GrammarItem,
  type ReviewLog,
  type SrsDailyRecord,
  type VocabItem,
} from "./db";
import type { Card } from "./srs";

export interface ItemAccuracy {
  total: number;
  again: number;
  lastAt: number;
}

/** Clé d'agrégation par élément : la même id peut exister en grammaire ET compréhension. */
export function accuracyKey(track: ReviewLog["track"], itemId: string): string {
  return `${track}:${itemId}`;
}

/** Précision par élément (toutes compétences confondues pour le vocabulaire). */
export function perItemAccuracy(reviews: ReviewLog[]): Map<string, ItemAccuracy> {
  const out = new Map<string, ItemAccuracy>();
  for (const r of reviews) {
    if (r.grade === RESET_GRADE) continue; // jalon, pas une révision
    const key = accuracyKey(r.track, r.itemId);
    const cur = out.get(key) ?? { total: 0, again: 0, lastAt: 0 };
    cur.total++;
    if (r.grade === "again") cur.again++;
    if (r.at > cur.lastAt) cur.lastAt = r.at;
    out.set(key, cur);
  }
  return out;
}

/** Période d'observation des statistiques : N derniers jours, ou tout l'historique. */
export type StatsPeriod = number | "all";

export interface Retention {
  total: number;
  correct: number;
  /** null si aucune révision comptable dans la fenêtre. */
  rate: number | null;
}

/**
 * Taux de rétention sur la fenêtre glissante : part des révisions non ratées, en
 * EXCLUANT la toute première révision de chaque (piste, élément, compétence) — une
 * première exposition n'est pas de la rétention. Approximation : le log ne porte pas
 * l'état FSRS de la carte au moment de la révision.
 */
export function retentionRate(reviews: ReviewLog[], period: StatsPeriod, now: Date): Retention {
  const sorted = [...reviews].sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  // La première exposition est repérée sur TOUT le log, pas seulement dans la fenêtre :
  // une carte vue pour la première fois avant la fenêtre y est bien de la rétention.
  const cutoff = period === "all" ? -Infinity : now.getTime() - period * 86_400_000;
  let total = 0;
  let again = 0;
  for (const r of sorted) {
    if (r.grade === RESET_GRADE) continue; // jalon, pas une révision
    const key = `${r.track}:${r.itemId}|${r.skill ?? ""}`;
    const first = !seen.has(key);
    seen.add(key);
    if (first) continue;
    if (r.at < cutoff || r.at > now.getTime()) continue;
    total++;
    if (r.grade === "again") again++;
  }
  const correct = total - again;
  return { total, correct, rate: total > 0 ? correct / total : null };
}

/** Toutes les cartes FSRS existantes (toutes compétences vocab + grammaire + compréhension). */
export function collectCards(
  vocab: VocabItem[],
  grammar: GrammarItem[],
  comprehension: ComprehensionItem[],
): Card[] {
  const cards: Card[] = [];
  for (const v of vocab) {
    for (const c of Object.values(v.cards)) if (c) cards.push(c);
  }
  for (const g of grammar) if (g.card) cards.push(g.card);
  for (const c of comprehension) if (c.card) cards.push(c.card);
  return cards;
}

export interface ForecastDay {
  date: string; // "YYYY-MM-DD"
  count: number;
}

/**
 * Charge de révisions à venir : cartes dues par jour local sur `days` jours, les
 * retards accumulés étant clampés dans le jour 0 (ils seront servis aujourd'hui).
 */
export function reviewForecast(cards: Card[], now: Date, days = 7): ForecastDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const out: ForecastDay[] = Array.from({ length: days }, (_, i) => ({
    date: localDateString(new Date(start.getTime() + i * 86_400_000)),
    count: 0,
  }));
  for (const c of cards) {
    const dueDay = new Date(c.due);
    dueDay.setHours(0, 0, 0, 0);
    const idx = Math.max(0, Math.round((dueDay.getTime() - start.getTime()) / 86_400_000));
    if (idx < days) out[idx].count++;
  }
  return out;
}

/**
 * Échecs cumulés par élément, DEPUIS sa dernière remise à zéro : un jalon `RESET_GRADE`
 * remet le compteur à zéro (le log est append-only, cf. db.ts).
 */
export function lapseCounts(reviews: ReviewLog[]): Map<string, number> {
  const lapses = new Map<string, number>();
  for (const r of [...reviews].sort((a, b) => a.at - b.at)) {
    if (r.grade === RESET_GRADE) lapses.set(r.itemId, 0);
    else if (r.grade === "again") lapses.set(r.itemId, (lapses.get(r.itemId) ?? 0) + 1);
  }
  return lapses;
}

// Activité journalière (store `srsDaily`) ------------------------------------------------

/** Jour vide : un jour SANS activité n'a aucune entrée en base, il faut le fabriquer. */
function emptyDay(date: string): SrsDailyRecord {
  return { date, introduced: 0, reviewed: 0 };
}

/**
 * Jours CONTIGUS de la fenêtre, de son premier jour à `today` inclus, trous comblés par des
 * jours vides — sans quoi une absence se recollerait visuellement au jour suivant.
 * `"all"` part du premier jour connu (fenêtre vide réduite à aujourd'hui).
 */
export function dailyWindow(
  daily: SrsDailyRecord[],
  period: StatsPeriod,
  today: string,
): SrsDailyRecord[] {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const known = [...byDate.keys()].sort();
  const first = known.find((d) => d <= today);
  const start =
    period === "all" ? (first ?? today) : shiftDay(today, -(Math.max(1, Math.round(period)) - 1));
  const out: SrsDailyRecord[] = [];
  for (let date = start; date <= today; date = shiftDay(date, 1)) {
    out.push(byDate.get(date) ?? emptyDay(date));
  }
  return out;
}

export type Granularity = "day" | "week" | "month";

/**
 * Granularité des barres d'activité : au-delà de ~5 semaines, une barre par jour devient
 * une forêt illisible — on regroupe par semaine, puis par mois sur une longue histoire.
 */
export function pickGranularity(dayCount: number): Granularity {
  if (dayCount <= 35) return "day";
  if (dayCount <= 182) return "week";
  return "month";
}

export interface ActivityBucket {
  /** Premier jour du seau (« YYYY-MM-DD ») — c'est sa clé ET ce qui l'étiquette. */
  start: string;
  /** Jours de la fenêtre tombant dans ce seau (le premier et le dernier sont partiels). */
  days: number;
  flowMs: number;
  reviewed: number;
  introduced: number;
}

/** Lundi de la semaine d'une date calendaire (semaine ISO : la semaine commence lundi). */
function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return shiftDay(date, -((day + 6) % 7));
}

function bucketStart(date: string, granularity: Granularity): string {
  if (granularity === "day") return date;
  if (granularity === "week") return weekStart(date);
  return `${date.slice(0, 7)}-01`;
}

/** Regroupe des jours contigus (cf. `dailyWindow`) en seaux jour / semaine / mois. */
export function bucketActivity(days: SrsDailyRecord[], granularity: Granularity): ActivityBucket[] {
  const out: ActivityBucket[] = [];
  const index = new Map<string, ActivityBucket>();
  for (const d of days) {
    const start = bucketStart(d.date, granularity);
    let bucket = index.get(start);
    if (!bucket) {
      bucket = { start, days: 0, flowMs: 0, reviewed: 0, introduced: 0 };
      index.set(start, bucket);
      out.push(bucket);
    }
    bucket.days++;
    bucket.flowMs += d.flowMs ?? 0;
    bucket.reviewed += d.reviewed;
    bucket.introduced += d.introduced;
  }
  return out;
}

export interface ActivityTotals {
  flowMs: number;
  reviewed: number;
  introduced: number;
  /** Jours où quelque chose s'est passé — le dénominateur honnête d'une moyenne. */
  activeDays: number;
  days: number;
}

export function activityTotals(days: SrsDailyRecord[]): ActivityTotals {
  const out: ActivityTotals = { flowMs: 0, reviewed: 0, introduced: 0, activeDays: 0, days: days.length };
  for (const d of days) {
    out.flowMs += d.flowMs ?? 0;
    out.reviewed += d.reviewed;
    out.introduced += d.introduced;
    if ((d.flowMs ?? 0) > 0 || d.reviewed > 0 || d.introduced > 0) out.activeDays++;
  }
  return out;
}

/** Éléments difficiles : ≥ SRS.leechLapses échecs depuis la dernière remise à zéro. */
export function leechIds(reviews: ReviewLog[]): Set<string> {
  const ids = new Set<string>();
  for (const [id, count] of lapseCounts(reviews)) {
    if (count >= SRS.leechLapses) ids.add(id);
  }
  return ids;
}

/**
 * Décale une date calendaire (YYYY-MM-DD) de `days` jours, sans fuseau : les chaînes sont
 * manipulées en UTC et ne servent qu'à être comparées entre elles (l'ordre alphabétique
 * d'une date ISO EST l'ordre chronologique).
 */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

const prevDay = (date: string): string => shiftDay(date, -1);

/**
 * Série de jours consécutifs à objectif atteint. Un aujourd'hui encore incomplet ne casse
 * pas la série (la journée n'est pas finie) : on l'ignore et on compte depuis hier.
 * Partagée entre l'accueil et les rappels, qui doivent afficher le MÊME chiffre.
 *
 * Un jour d'absence n'a PAS d'entrée dans `srsDaily` : parcourir les seules entrées connues
 * compterait la série à travers le trou. On avance donc de veille en veille, et le premier
 * jour manquant ou en dessous de l'objectif arrête le compte.
 */
export function reviewStreak(
  daily: { date: string; reviewed: number }[],
  dailyGoal: number,
  today: string,
): number {
  const byDate = new Map(daily.map((d) => [d.date, d.reviewed]));
  let streak = 0;
  // Borne `streak < byDate.size` : sans elle, un objectif à 0 ferait boucler à l'infini.
  for (
    let date = prevDay(today);
    streak < byDate.size && (byDate.get(date) ?? 0) >= dailyGoal;
    date = prevDay(date)
  ) {
    streak++;
  }
  if ((byDate.get(today) ?? 0) >= dailyGoal) streak++;
  return streak;
}
