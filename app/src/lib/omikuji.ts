// Omikuji du jour : un tirage quotidien façon oracle de temple — une fortune et un petit
// défi SURPRISE, détectable automatiquement avec la télémétrie existante (log reviews +
// srsDaily). Réussir le défi fait gagner du chemin sur le Tōkaidō ; la fortune fixe la
// mise (grande fortune = demi-station, infortune = huitième — jamais zéro).
//
// RÈGLE DURE : tirage DÉTERMINISTE PAR DATE (hash de la date locale, mulberry32 inline) —
// pas de Math.random ni de random.ts (non seedé) : re-tirer le même jour redonne le même
// défi, et les tests peuvent rejouer une date.

import {
  allReviews,
  allStories,
  allVocab,
  getOmikuji,
  getSrsDaily,
  localDateString,
  putOmikuji,
  type OmikujiFortune,
  type OmikujiRecord,
} from "./db";
import { loadSettings } from "./settings";
import { addTokaidoBonus } from "./tokaido";

export interface Fortune {
  id: OmikujiFortune;
  kanji: string;
  yomi: string;
  romaji: string;
  fr: string;
  /** Poids de tirage (les extrêmes sont rares, comme au temple). */
  weight: number;
  /** Fraction de station Tōkaidō gagnée si le défi du jour est accompli. */
  bonus: number;
  /** Le bonus en toutes lettres (affiché sur la bandelette). */
  bonusFr: string;
}

// Échelle traditionnelle, du meilleur au pire. La fortune n'est plus purement décorative :
// elle fixe la mise — le CHEMIN gagné sur le Tōkaidō quand le défi est accompli. Une
// mauvaise fortune rapporte moins, mais rapporte toujours (on ne punit jamais).
export const FORTUNES: Fortune[] = [
  { id: "daikichi", kanji: "大吉", yomi: "だいきち", romaji: "daikichi", fr: "Grande fortune", weight: 2, bonus: 0.5, bonusFr: "une demi-station" },
  { id: "kichi", kanji: "吉", yomi: "きち", romaji: "kichi", fr: "Fortune", weight: 4, bonus: 0.25, bonusFr: "un quart de station" },
  { id: "chukichi", kanji: "中吉", yomi: "ちゅうきち", romaji: "chūkichi", fr: "Fortune moyenne", weight: 4, bonus: 0.25, bonusFr: "un quart de station" },
  { id: "shokichi", kanji: "小吉", yomi: "しょうきち", romaji: "shōkichi", fr: "Petite fortune", weight: 4, bonus: 0.25, bonusFr: "un quart de station" },
  { id: "hankichi", kanji: "半吉", yomi: "はんきち", romaji: "hankichi", fr: "Demi-fortune", weight: 2, bonus: 0.25, bonusFr: "un quart de station" },
  { id: "suekichi", kanji: "末吉", yomi: "すえきち", romaji: "suekichi", fr: "Fortune à venir", weight: 3, bonus: 0.25, bonusFr: "un quart de station" },
  { id: "kyo", kanji: "凶", yomi: "きょう", romaji: "kyō", fr: "Infortune", weight: 2, bonus: 0.125, bonusFr: "un huitième de station" },
  { id: "daikyo", kanji: "大凶", yomi: "だいきょう", romaji: "daikyō", fr: "Grande infortune", weight: 1, bonus: 0.125, bonusFr: "un huitième de station" },
];

export function fortuneById(id: OmikujiFortune): Fortune {
  return FORTUNES.find((f) => f.id === id) ?? FORTUNES[1];
}

export interface OmikujiEnv {
  dailyGoal: number;
  reviewedToday: number;
  hasProductionCards: boolean;
  hasOralCards: boolean;
  hasStories: boolean;
}

/** Compteurs du jour utilisés par les détecteurs. */
export interface DayCounts {
  reviewed: number;
  prodOk: number;
  oralOk: number;
  storiesRead: number;
  dayReviews: number;
  dayCorrect: number;
}

export interface OmikujiChallenge {
  id: string;
  label: (env: OmikujiEnv) => string;
  metric: "reviewed" | "prodOk" | "oralOk" | "storiesRead" | "accuracy";
  target: (env: OmikujiEnv) => number;
  available: (env: OmikujiEnv) => boolean;
}

// Tous les défis sont DÉTECTABLES sans instrumentation nouvelle. (Extension future notée :
// « lis N phrases sans gloss » exigerait d'instrumenter le toggle gloss — hors scope.)
export const CHALLENGES: OmikujiChallenge[] = [
  {
    id: "reviews-goal",
    label: (env) => `Atteins ton objectif du jour (${env.dailyGoal} révisions)`,
    metric: "reviewed",
    target: (env) => env.dailyGoal,
    // Sans intérêt si l'objectif est déjà atteint au tirage.
    available: (env) => env.reviewedToday < env.dailyGoal,
  },
  {
    id: "reviews-stretch",
    label: (env) => `Dépasse ton objectif du jour de 10 révisions (${env.dailyGoal + 10})`,
    metric: "reviewed",
    target: (env) => env.dailyGoal + 10,
    available: (env) => env.reviewedToday < env.dailyGoal + 10,
  },
  {
    id: "prod-5",
    label: () => "Réussis 5 mots en production",
    metric: "prodOk",
    target: () => 5,
    available: (env) => env.hasProductionCards,
  },
  {
    id: "prod-10",
    label: () => "Réussis 10 mots en production",
    metric: "prodOk",
    target: () => 10,
    available: (env) => env.hasProductionCards,
  },
  {
    id: "oral-5",
    label: () => "Réussis 5 exercices d'écoute",
    metric: "oralOk",
    target: () => 5,
    available: (env) => env.hasOralCards,
  },
  {
    id: "oral-10",
    label: () => "Réussis 10 exercices d'écoute",
    metric: "oralOk",
    target: () => 10,
    available: (env) => env.hasOralCards,
  },
  {
    id: "story-1",
    label: () => "Lis une histoire aujourd'hui",
    metric: "storiesRead",
    target: () => 1,
    available: (env) => env.hasStories,
  },
  {
    id: "story-2",
    label: () => "Lis deux histoires aujourd'hui",
    metric: "storiesRead",
    target: () => 2,
    available: (env) => env.hasStories,
  },
  {
    id: "accuracy-80",
    label: () => "Termine la journée à 80 % de réussite (au moins 10 révisions)",
    metric: "accuracy",
    target: () => 80,
    available: () => true,
  },
  {
    id: "accuracy-90",
    label: () => "Termine la journée à 90 % de réussite (au moins 10 révisions)",
    metric: "accuracy",
    target: () => 90,
    available: () => true,
  },
];

export function challengeById(id: string): OmikujiChallenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

// ---- Tirage déterministe -------------------------------------------------------

/** mulberry32 : PRNG minuscule et suffisant, seedé par le hash de la date locale. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tirage pondéré : les extrêmes (大吉, 大凶) sortent rarement. */
function pickFortune(roll: number): OmikujiFortune {
  const total = FORTUNES.reduce((s, f) => s + f.weight, 0);
  let r = roll * total;
  for (const f of FORTUNES) {
    r -= f.weight;
    if (r < 0) return f.id;
  }
  return FORTUNES[FORTUNES.length - 1].id;
}

/** Choix pur du défi et de la fortune pour une date (testable sans IO). */
export function drawFor(
  date: string,
  env: OmikujiEnv,
): { challenge: OmikujiChallenge; fortune: OmikujiFortune } {
  const rng = mulberry32(hashString(date));
  const eligible = CHALLENGES.filter((c) => c.available(env));
  const pool = eligible.length > 0 ? eligible : CHALLENGES.filter((c) => c.id === "accuracy-90");
  const challenge = pool[Math.floor(rng() * pool.length)];
  // La fortune module la récompense (bonus Tōkaidō), jamais une punition.
  const fortune = pickFortune(rng());
  return { challenge, fortune };
}

// ---- IO --------------------------------------------------------------------------

async function collectDayCounts(now: Date): Promise<DayCounts> {
  const today = localDateString(now);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [daily, reviews] = await Promise.all([getSrsDaily(today), allReviews()]);
  const dayLogs = reviews.filter((r) => r.at >= dayStart);
  return {
    reviewed: daily?.reviewed ?? 0,
    prodOk: dayLogs.filter((r) => r.skill === "production" && r.grade !== "again").length,
    oralOk: dayLogs.filter((r) => r.skill === "oral" && r.grade !== "again").length,
    storiesRead: daily?.storiesRead ?? 0,
    dayReviews: dayLogs.length,
    dayCorrect: dayLogs.filter((r) => r.grade !== "again").length,
  };
}

async function collectEnv(now: Date): Promise<OmikujiEnv> {
  const [vocab, stories, daily] = await Promise.all([
    allVocab(),
    allStories(),
    getSrsDaily(localDateString(now)),
  ]);
  return {
    dailyGoal: loadSettings().dailyGoal,
    reviewedToday: daily?.reviewed ?? 0,
    hasProductionCards: vocab.some((v) => v.cards.production),
    hasOralCards: vocab.some((v) => v.cards.oral),
    hasStories: stories.length > 0,
  };
}

/** Tire l'omikuji du jour (idempotent : un seul tirage par date locale). */
export async function drawOmikuji(now: Date = new Date()): Promise<OmikujiRecord> {
  const date = localDateString(now);
  const existing = await getOmikuji(date);
  if (existing) return existing;
  const env = await collectEnv(now);
  const { challenge, fortune } = drawFor(date, env);
  const counts = await collectDayCounts(now);
  const rec: OmikujiRecord = {
    date,
    challengeId: challenge.id,
    fortune,
    drawnAt: now.getTime(),
    baseline: {
      reviewed: counts.reviewed,
      prodOk: counts.prodOk,
      oralOk: counts.oralOk,
      storiesRead: counts.storiesRead,
    },
  };
  await putOmikuji(rec);
  return rec;
}

/** Progression d'un défi : `done`/`target` pour la jauge (les deux ≥ 0). */
export function omikujiProgress(
  rec: OmikujiRecord,
  counts: DayCounts,
  env: OmikujiEnv,
): { done: number; target: number } {
  const challenge = challengeById(rec.challengeId);
  if (!challenge) return { done: 0, target: 1 };
  const target = challenge.target(env);
  switch (challenge.metric) {
    case "reviewed":
      return { done: Math.min(target, counts.reviewed), target };
    case "prodOk":
      return { done: Math.min(target, counts.prodOk - rec.baseline.prodOk), target };
    case "oralOk":
      return { done: Math.min(target, counts.oralOk - rec.baseline.oralOk), target };
    case "storiesRead":
      return { done: Math.min(target, counts.storiesRead - rec.baseline.storiesRead), target };
    case "accuracy": {
      // Jauge = précision du jour ; le défi exige AUSSI ≥ 10 révisions (voir isMet).
      const acc = counts.dayReviews === 0 ? 0 : counts.dayCorrect / counts.dayReviews;
      return { done: Math.round(acc * 100), target };
    }
  }
}

function isMet(rec: OmikujiRecord, counts: DayCounts, env: OmikujiEnv): boolean {
  const challenge = challengeById(rec.challengeId);
  if (!challenge) return false;
  const { done, target } = omikujiProgress(rec, counts, env);
  if (challenge.metric === "accuracy") return counts.dayReviews >= 10 && done >= target;
  return done >= target;
}

export interface OmikujiCheck {
  rec: OmikujiRecord;
  counts: DayCounts;
  env: OmikujiEnv;
  /** Le défi vient d'être accompli par CET appel (bonus crédité, bandeau à afficher). */
  completedNow: boolean;
}

/**
 * Évalue le défi du jour ; s'il vient d'être accompli, marque `completedAt` et crédite le
 * bonus Tōkaidō (une seule fois — idempotent). Null si rien n'a été tiré aujourd'hui.
 */
export async function checkOmikuji(now: Date = new Date()): Promise<OmikujiCheck | null> {
  const rec = await getOmikuji(localDateString(now));
  if (!rec) return null;
  const [counts, env] = await Promise.all([collectDayCounts(now), collectEnv(now)]);
  if (rec.completedAt) return { rec, counts, env, completedNow: false };
  if (!isMet(rec, counts, env)) return { rec, counts, env, completedNow: false };
  const updated = { ...rec, completedAt: now.getTime() };
  await putOmikuji(updated);
  await addTokaidoBonus(fortuneById(rec.fortune).bonus);
  return { rec: updated, counts, env, completedNow: true };
}
