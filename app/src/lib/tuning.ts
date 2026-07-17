// Auto-réglage du SRS piloté par la performance mesurée (taux d'erreur / rétention).
// Un seul signal nourrit deux leviers :
//   - la CIBLE de rétention FSRS (`request_retention`) : beaucoup d'erreurs → cible relevée
//     → intervalles plus courts → on revoit plus souvent ; peu d'erreurs → cible abaissée
//     → intervalles étirés. `ts-fsrs` n'embarque pas d'optimiseur de poids ; ajuster la cible
//     est l'équivalent robuste, offline et sans dépendance.
//   - le DÉBIT de nouveautés (`newPerDay` effectif) : on ralentit quand la rétention chute
//     ou que le retard s'accumule, pour éviter l'effet boule de neige.
// Cœur pur (fonctions ci-dessous, testables sans IndexedDB) + wrapper IO qui persiste l'état
// dans le KV `meta` (aucun bump de schéma).

import { SRS } from "./config";
import {
  allComprehension,
  allGrammar,
  allReviews,
  allVocab,
  getMeta,
  putMeta,
} from "./db";
import { isDue } from "./srs";
import { collectCards, retentionRate } from "./stats";

/** Cible de vraie rétention visée par le contrôleur (défaut FSRS). */
export const TARGET_RETENTION = 0.9;
/** En dessous de ce nombre de révisions comptables, on ne bouge pas (bruit). */
export const MIN_SAMPLE = 30;
/** Fenêtre de mesure de la rétention (jours). */
export const TUNING_WINDOW_DAYS = 30;
/** Bornes de sécurité de la cible de rétention. */
export const RETENTION_MIN = 0.8;
export const RETENTION_MAX = 0.97;
/** Gain proportionnel et zone morte (hystérésis) du contrôleur. */
const STEP = 0.5;
const HYSTERESIS = 0.02;
/** Recalcul si l'état stocké est plus vieux que ça. */
const STALE_MS = 12 * 60 * 60 * 1000;

const DEFAULT_TUNING: FsrsTuning = {
  requestRetention: TARGET_RETENTION,
  measuredRetention: null,
  sampleSize: 0,
  backlog: 0,
  computedAt: 0,
};

export interface FsrsTuning {
  /** Cible `request_retention` appliquée au scheduler FSRS. */
  requestRetention: number;
  /** Rétention mesurée sur la fenêtre (null si trop peu de données). */
  measuredRetention: number | null;
  /** Nombre de révisions comptables dans la fenêtre. */
  sampleSize: number;
  /** Nombre de cartes dues au moment du calcul. */
  backlog: number;
  computedAt: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Nouvelle cible de rétention à partir de la précédente et de la rétention mesurée.
 * Contrôleur proportionnel borné : `err = cible − mesurée`. Si l'utilisateur rate beaucoup
 * (mesurée < cible), `err > 0` → la cible monte → intervalles plus courts. Zone morte pour
 * ne pas osciller ; inchangé tant que l'échantillon est trop petit.
 */
export function computeTunedRetention(
  prevR: number,
  measured: number | null,
  sampleSize: number,
): number {
  if (measured === null || sampleSize < MIN_SAMPLE) return prevR;
  const err = TARGET_RETENTION - measured;
  if (Math.abs(err) < HYSTERESIS) return prevR;
  return clamp(prevR + STEP * err, RETENTION_MIN, RETENTION_MAX);
}

/**
 * Débit de nouveautés effectif. On coupe/ralentit quand la rétention est basse (l'utilisateur
 * peine) ou que le retard dû est important — mieux vaut consolider que d'empiler du neuf.
 */
export function effectiveNewPerDay(
  base: number,
  measured: number | null,
  backlog: number,
): number {
  const struggling = measured !== null && measured < RETENTION_MIN;
  const heavyBacklog = backlog > 2 * SRS.sessionCap;
  if (struggling && heavyBacklog) return 0;
  if (struggling || heavyBacklog) return Math.max(0, Math.round(base / 2));
  if (backlog > SRS.sessionCap) return Math.max(0, Math.round(base * 0.75));
  return base;
}

// ---- Wrapper IO (persistance dans `meta`) -----------------------------------

const META_KEY = "fsrsTuning";

/** Nombre de cartes FSRS dues à l'instant `now` (toutes pistes/compétences). */
async function measureBacklog(now: Date): Promise<number> {
  const [vocab, grammar, comprehension] = await Promise.all([
    allVocab(),
    allGrammar(),
    allComprehension(),
  ]);
  return collectCards(vocab, grammar, comprehension).filter((c) => isDue(c, now)).length;
}

/** État courant (défaut si jamais calculé). */
export async function loadTuning(): Promise<FsrsTuning> {
  return (await getMeta<FsrsTuning>(META_KEY)) ?? DEFAULT_TUNING;
}

/**
 * Recalcule l'état à partir du log de révisions et du backlog, persiste et le renvoie.
 * La nouvelle cible part de la cible précédente (le contrôleur est incrémental).
 */
export async function recomputeTuning(now: Date = new Date()): Promise<FsrsTuning> {
  const prev = await loadTuning();
  const reviews = await allReviews();
  const { rate, total } = retentionRate(reviews, TUNING_WINDOW_DAYS, now);
  const backlog = await measureBacklog(now);
  const next: FsrsTuning = {
    requestRetention: computeTunedRetention(prev.requestRetention, rate, total),
    measuredRetention: rate,
    sampleSize: total,
    backlog,
    computedAt: now.getTime(),
  };
  await putMeta(META_KEY, next);
  return next;
}

/**
 * Applique la cible stockée au scheduler FSRS puis, si l'état est périmé, recalcule en
 * arrière-plan et réapplique. Appelé au démarrage (main.tsx). Import dynamique de `srs`
 * pour éviter un cycle (srs ne dépend pas de tuning).
 */
export async function initTuning(now: Date = new Date()): Promise<void> {
  const { setRequestRetention } = await import("./srs");
  const stored = await loadTuning();
  setRequestRetention(stored.requestRetention);
  if (now.getTime() - stored.computedAt < STALE_MS) return;
  const fresh = await recomputeTuning(now);
  setRequestRetention(fresh.requestRetention);
}
