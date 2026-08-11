// Statistiques d'apprentissage dérivées LOCALEMENT du log de révisions (append-only,
// store `reviews`) et des cartes FSRS — aucun LLM, aucun réseau. Fonctions pures
// (données en argument) → testables sans IndexedDB.

import { SRS } from "./config";
import {
  localDateString,
  type ComprehensionItem,
  type GrammarItem,
  type ReviewLog,
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
    const key = accuracyKey(r.track, r.itemId);
    const cur = out.get(key) ?? { total: 0, again: 0, lastAt: 0 };
    cur.total++;
    if (r.grade === "again") cur.again++;
    if (r.at > cur.lastAt) cur.lastAt = r.at;
    out.set(key, cur);
  }
  return out;
}

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
export function retentionRate(reviews: ReviewLog[], windowDays: number, now: Date): Retention {
  const sorted = [...reviews].sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const cutoff = now.getTime() - windowDays * 86_400_000;
  let total = 0;
  let again = 0;
  for (const r of sorted) {
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

/** Éléments difficiles : ≥ SRS.leechLapses échecs cumulés dans le log. */
export function leechIds(reviews: ReviewLog[]): Set<string> {
  const lapses = new Map<string, number>();
  for (const r of reviews) {
    if (r.grade === "again") lapses.set(r.itemId, (lapses.get(r.itemId) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [id, count] of lapses) {
    if (count >= SRS.leechLapses) ids.add(id);
  }
  return ids;
}

/** Veille d'une date calendaire (YYYY-MM-DD), sans fuseau : on ne compare que des chaînes. */
function prevDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

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
