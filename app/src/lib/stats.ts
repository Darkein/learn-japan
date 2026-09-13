// Statistiques d'apprentissage dérivées LOCALEMENT du log de révisions (append-only,
// store `reviews`) et des cartes FSRS — aucun LLM, aucun réseau. Fonctions pures
// (données en argument) → testables sans IndexedDB.

import { SRS } from "./config";
import {
  localDateString,
  RESET_GRADE,
  type ComprehensionItem,
  type GrammarItem,
  type ItemStatus,
  type ReviewLog,
  type SrsDailyRecord,
  type VocabItem,
} from "./db";
import { isMastered, State, type Card } from "./srs";

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
 * Échecs COURANTS par élément — la mesure derrière le statut « difficile ».
 *
 * Ce n'est PAS un total de vie : celui-ci ne fait que croître, si bien qu'un mot su par cœur,
 * revu des centaines de fois, finissait marqué difficile pour quelques fautes de frappe
 * anciennes, sans plus jamais pouvoir en sortir. Deux choses remettent donc le compteur à
 * zéro :
 *
 * - un jalon `RESET_GRADE`, posé par la remise à zéro manuelle (lib/leech.ts) — le log est
 *   append-only, cf. db.ts ;
 * - `SRS.leechRecoveryStreak` réussites d'affilée : le statut se perd comme il se gagne. Un
 *   raté isolé noyé dans les bonnes réponses ne laisse aucune trace, tandis qu'un élément
 *   réellement instable rechute avant d'avoir bouclé sa série et voit son compteur monter.
 *
 * Toutes compétences confondues (écrit / écoute / production), comme le statut qu'il alimente.
 * Une note autre que « again » vaut réussite — « Difficile » compris, qui reste une réponse
 * trouvée (c'est déjà la convention de `retentionRate` et de `perItemAccuracy`).
 */
export function lapseCounts(reviews: ReviewLog[]): Map<string, number> {
  const lapses = new Map<string, number>();
  // Réussites consécutives en cours, par élément. Ni le jalon ni un échec n'en font partie.
  const streak = new Map<string, number>();
  for (const r of [...reviews].sort((a, b) => a.at - b.at)) {
    if (r.grade === RESET_GRADE) {
      lapses.set(r.itemId, 0);
      streak.set(r.itemId, 0);
    } else if (r.grade === "again") {
      lapses.set(r.itemId, (lapses.get(r.itemId) ?? 0) + 1);
      streak.set(r.itemId, 0);
    } else {
      const run = (streak.get(r.itemId) ?? 0) + 1;
      if (run >= SRS.leechRecoveryStreak) {
        lapses.set(r.itemId, 0);
        streak.set(r.itemId, 0);
      } else {
        streak.set(r.itemId, run);
      }
    }
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
 * Sert aussi bien à totaliser une période qu'à tracer les quelques derniers jours.
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

export interface ActivityTotals {
  flowMs: number;
  reviewed: number;
  introduced: number;
  storiesRead: number;
  /** Jours où quelque chose s'est passé — le dénominateur honnête d'une moyenne. */
  activeDays: number;
  days: number;
}

export function activityTotals(days: SrsDailyRecord[]): ActivityTotals {
  const out: ActivityTotals = {
    flowMs: 0,
    reviewed: 0,
    introduced: 0,
    storiesRead: 0,
    activeDays: 0,
    days: days.length,
  };
  for (const d of days) {
    out.flowMs += d.flowMs ?? 0;
    out.reviewed += d.reviewed;
    out.introduced += d.introduced;
    out.storiesRead += d.storiesRead ?? 0;
    if ((d.flowMs ?? 0) > 0 || d.reviewed > 0 || d.introduced > 0) out.activeDays++;
  }
  return out;
}

// État courant : ce qui ne dépend PAS d'une période -------------------------------------

export interface StatusCounts {
  total: number;
  known: number;
  review: number;
  unknown: number;
}

/** Répartition d'une piste par statut (une piste = les items SUIVIS, pas l'inventaire entier). */
export function statusCounts(items: { status: ItemStatus }[]): StatusCounts {
  const out: StatusCounts = { total: items.length, known: 0, review: 0, unknown: 0 };
  for (const it of items) out[it.status]++;
  return out;
}

export interface CardMaturity {
  total: number;
  /** Jamais révisée (FSRS `New`). */
  fresh: number;
  /** En apprentissage ou en réapprentissage après un échec. */
  learning: number;
  /** En révision, mais encore en dessous du seuil de maîtrise. */
  young: number;
  /** Maîtrisée : en révision avec un intervalle ≥ SRS.masteredIntervalDays. */
  mature: number;
}

/**
 * Répartition des cartes par maturité — la photo de l'édifice, indépendante de toute
 * période : ce qui est acquis l'est, qu'on ait travaillé cette semaine ou pas.
 */
export function cardMaturity(cards: Card[]): CardMaturity {
  const out: CardMaturity = { total: cards.length, fresh: 0, learning: 0, young: 0, mature: 0 };
  for (const c of cards) {
    if (c.state === State.New) out.fresh++;
    else if (c.state === State.Learning || c.state === State.Relearning) out.learning++;
    else if (isMastered(c)) out.mature++;
    else out.young++;
  }
  return out;
}

/** Nombre de jours calendaires de `from` à `to` (négatif si `to` précède `from`). */
export function daysBetween(from: string, to: string): number {
  const ms = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/**
 * Premier jour d'activité connu, compteurs journaliers ET log de révisions confondus : les
 * deux stores ont pu commencer à des dates différentes (une révision d'avant les compteurs).
 */
export function firstActiveDay(daily: SrsDailyRecord[], reviews: ReviewLog[]): string | null {
  let first: string | null = null;
  for (const d of daily) if (!first || d.date < first) first = d.date;
  for (const r of reviews) {
    const date = localDateString(new Date(r.at));
    if (!first || date < first) first = date;
  }
  return first;
}

/** Éléments difficiles : ≥ SRS.leechLapses échecs COURANTS (cf. `lapseCounts`). */
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
