// Quel TYPE d'exercice servir pour un mot dû (SPEC §2.2). Module pur, sans accès à la base :
// il ordonne les types candidats, la construction vit dans exerciseBuild.buildDrill.
//
// Un mot porte UNE carte FSRS — une échéance, un passage. Le type d'exercice, lui, est tiré
// à chaque passage parmi les cinq formes du répertoire : c'est ce qui remplace les trois
// cartes d'autrefois (écrit / écoute / production), planifiées séparément, qui faisaient
// repasser le même mot jusqu'à trois fois là où d'autres attendaient leur tour.
//
// Deux règles de tirage, mêmes principes que les directions du triangle (lib/vocabFaces.ts) :
// on ne redonne pas la forme du passage précédent, et l'écrit est pondéré — c'est la seule
// forme qui marche pour TOUS les mots, et celle qui fait avancer la série de saisie.

import type { Skill, VocabItem } from "./db";
import { SRS } from "./config";
import { State } from "./srs";
import { weightedShuffle } from "./random";

/**
 * Les cinq formes du répertoire :
 *  - `written`        : le triangle kanji ↔ furigana ↔ traduction (lib/vocabFaces.ts) ;
 *  - `listen-word`    : on entend, on écrit le mot (dans sa phrase quand elle le dit) ;
 *  - `listen-meaning` : on entend la phrase, on choisit le sens du mot ;
 *  - `dictation`      : on entend la phrase, on la reconstruit par tuiles ;
 *  - `production`     : on complète la phrase en japonais à partir du français.
 */
export type DrillKind =
  | "written"
  | "listen-word"
  | "listen-meaning"
  | "dictation"
  | "production";

export const DRILL_KINDS: DrillKind[] = [
  "written",
  "listen-word",
  "listen-meaning",
  "dictation",
  "production",
];

/** Les formes qui passent par l'oreille — écartées en bloc sans le son. */
const AUDIO_KINDS = new Set<DrillKind>(["listen-word", "listen-meaning", "dictation"]);

/**
 * Compétence journalisée pour chaque forme (`ReviewLog.skill`). Trois formes d'écoute pour
 * une seule compétence : ce que les statistiques et les défis omikuji comptent, c'est
 * « un exercice d'écoute réussi », pas la variante tirée.
 */
const KIND_SKILL: Record<DrillKind, Skill> = {
  written: "written",
  "listen-word": "oral",
  "listen-meaning": "oral",
  dictation: "oral",
  production: "production",
};

export function skillOf(kind: DrillKind): Skill {
  return KIND_SKILL[kind];
}

/**
 * Poids de l'écrit face à chacune des autres formes. Le triangle est le seul exercice
 * constructible pour n'importe quel mot (les autres demandent une phrase, du son, un pool de
 * distracteurs), et le seul qui fasse progresser la série qui ouvre la saisie
 * (`TYPE_STREAK`) : à poids égal, un mot mettrait cinq fois plus longtemps à y arriver.
 */
export const WRITTEN_WEIGHT = 2;

/** Contexte du tirage — ce que le mot seul ne dit pas. */
export interface DrillContext {
  /** Sans le son (réglage permanent ou pause « je ne peux pas écouter »). */
  silent?: boolean;
  /** Le mot porte une phrase d'exemple exploitable (`effectiveExample(v)?.ja`). */
  hasExample?: boolean;
}

/**
 * La forme est-elle recevable pour ce mot ? Deux verrous seulement, les autres conditions
 * (assez de distracteurs, phrase ni trop courte ni trop longue…) étant connues du seul
 * constructeur, qui rend `null` — l'appelant descend alors la liste.
 *
 * ① MATURITÉ. L'écoute et la production ne s'ouvrent pas sur un mot qu'on vient de
 *    rencontrer : reconnaître une graphie précède la reconnaître à l'oreille, et la
 *    produire vient en dernier (SPEC §2.2). Les seuils reprennent ceux des anciennes
 *    amorces : état `Review` pour l'écoute, et l'intervalle de déblocage en plus pour la
 *    production.
 * ② MATIÈRE. Pas de phrase d'exemple → pas de dictée, pas de sens à l'écoute, pas de
 *    production en contexte. Seule la dictée du MOT reste jouable (on prononce le mot).
 */
export function drillEligible(v: VocabItem, kind: DrillKind, ctx: DrillContext = {}): boolean {
  if (kind === "written") return true;
  if (ctx.silent && AUDIO_KINDS.has(kind)) return false;
  const card = v.card;
  if (!card || card.state !== State.Review) return false;
  if (kind === "listen-word") return true;
  if (!ctx.hasExample) return false;
  if (kind === "production") return card.scheduled_days >= SRS.unlockIntervalDays;
  return true;
}

/**
 * Formes candidates, dans l'ordre à essayer : mélangées en faveur de l'écrit, celle du
 * passage précédent reléguée en dernier (elle reste en repli — une forme n'est pas toujours
 * constructible). L'écrit ferme toujours la marche : quoi qu'il arrive, un mot dû a un
 * exercice.
 */
export function orderDrills(v: VocabItem, ctx: DrillContext = {}): DrillKind[] {
  const eligible = DRILL_KINDS.filter((k) => drillEligible(v, k, ctx));
  const fresh = weightedShuffle(
    eligible.filter((k) => k !== v.lastDrill),
    (k) => (k === "written" ? WRITTEN_WEIGHT : 1),
  );
  const stale = eligible.filter((k) => k === v.lastDrill);
  return [...fresh, ...stale];
}
