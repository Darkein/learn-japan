// Auto-réglage du SRS piloté par la performance mesurée (taux d'erreur / rétention).
// Un seul signal nourrit deux leviers :
//   - la CIBLE de rétention FSRS (`request_retention`) : beaucoup d'erreurs → cible relevée
//     → intervalles plus courts → on revoit plus souvent ; peu d'erreurs → cible abaissée
//     → intervalles étirés. `ts-fsrs` n'embarque pas d'optimiseur de poids ; ajuster la cible
//     est l'équivalent robuste, offline et sans dépendance.
//   - le DÉBIT de nouveautés (`newPerDay` effectif) : plafonné par ce que l'objectif quotidien
//     peut ABSORBER (`sustainableNewPerDay`), puis raboté quand la rétention chute ou que le
//     retard s'accumule — les deux mesurés en jours d'objectif, jamais en valeur absolue.
// Cœur pur (fonctions ci-dessous, testables sans IndexedDB) + wrapper IO qui persiste l'état
// dans le KV `meta` (aucun bump de schéma).

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
 * Coût d'un mot NEUF en cartes de révision par jour, à l'équilibre. Un mot n'est pas une
 * carte : il en porte jusqu'à trois (écrit / écoute / production, cf. `spaceSkillCards`),
 * chacune revenant d'autant plus souvent qu'elle est jeune.
 *
 * Valeur MESURÉE par simulation (90 jours, réponses « bien », objectif tenu chaque jour,
 * cf. `tuning.test.ts`) : à objectif 10 cartes/jour, 2 mots neufs/jour tiennent (retard
 * stable à ~0), 3 dérivent lentement, 5 font exploser le retard (+80 en trois mois). Le
 * rapport tenable est donc d'environ UN mot neuf pour cinq cartes d'objectif.
 */
export const NEW_ITEM_LOAD = 5;

/**
 * Débit de nouveautés que l'objectif quotidien peut ABSORBER, en mots par jour. C'est de
 * l'arithmétique, pas une préférence : introduire plus que ça garantit un retard qui croît
 * sans fin, quel que soit le réglage « Nouveaux mots par jour ».
 *
 * Plancher à 1 : la progression ne doit jamais se figer structurellement (sans nouveaux
 * items, la leçon en cours ne stabilise plus rien, son contrôle ne s'ouvre pas et la suite
 * reste verrouillée). Le freinage jusqu'à zéro reste possible, mais seulement comme réponse
 * TEMPORAIRE à un retard réel — voir `effectiveNewPerDay`.
 */
export function sustainableNewPerDay(dailyGoal: number): number {
  return Math.max(1, Math.round(dailyGoal / NEW_ITEM_LOAD));
}

/**
 * Retard exprimé en JOURS d'objectif quotidien — la seule unité qui veut dire quelque chose
 * pour l'utilisateur. 40 cartes dues, c'est deux jours de travail à 20 par jour et quatre
 * jours à 10 : un seuil en valeur absolue (l'ancien `SRS.sessionCap`) punissait le petit
 * objectif et laissait filer le grand.
 */
export function backlogDays(backlog: number, dailyGoal: number): number {
  return backlog / Math.max(1, dailyGoal);
}

/** Paliers du frein, en jours d'objectif : on ralentit, on divise, on coupe. */
export const BACKLOG_SLOW_DAYS = 1;
export const BACKLOG_HALF_DAYS = 2;
export const BACKLOG_STOP_DAYS = 3;

/**
 * Débit de nouveautés effectif : le plafond de CAPACITÉ (`sustainableNewPerDay`), puis un
 * frein qui le rabote quand la rétention est basse (l'utilisateur peine) ou que le retard
 * s'accumule — mieux vaut consolider que d'empiler du neuf.
 *
 * Boucle fermée : le retard coupe les nouveautés, l'absence de nouveautés laisse les
 * révisions vider le retard, et le débit repart. C'est ce qui BORNE le retard au lieu de le
 * laisser croître de `newPerDay` chaque jour.
 */
export function effectiveNewPerDay(
  base: number,
  measured: number | null,
  backlog: number,
  dailyGoal: number,
): number {
  // Le réglage de l'utilisateur est un PLAFOND SOUHAITÉ, pas une promesse : la capacité
  // de son objectif quotidien a le dernier mot.
  const ceiling = Math.min(base, sustainableNewPerDay(dailyGoal));
  const days = backlogDays(backlog, dailyGoal);
  const struggling = measured !== null && measured < RETENTION_MIN;
  if (days > BACKLOG_STOP_DAYS) return 0;
  if (struggling && days > BACKLOG_HALF_DAYS) return 0;
  // Plancher à 1 tant qu'on n'a pas atteint le palier de coupure : ralentir ne doit pas
  // équivaloir à couper (un plafond de 2 mots/jour divisé par deux tomberait à 1, puis 0).
  if (struggling || days > BACKLOG_HALF_DAYS) return Math.max(1, Math.floor(ceiling / 2));
  if (days > BACKLOG_SLOW_DAYS) return Math.max(1, Math.floor(ceiling * 0.75));
  return ceiling;
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
