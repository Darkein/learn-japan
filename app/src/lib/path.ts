// Le parcours d'une leçon (SPEC §5) : une suite FIXE d'étapes, toujours dans le même ordre.
// Module PUR — aucun IO : ce qu'une leçon a déjà fait est calculé par lib/lessons.ts, le
// choix de l'activité suivante par lib/flow.ts. Ici, seulement la forme du parcours.

import type { GrammarItem, VocabItem } from "./db";
import { isAcquired } from "./srs";
import { isTrainableVocab } from "./vocabFaces";

/** Les sept étapes d'une leçon, dans l'ordre du parcours. */
export type PathStep = "course" | "vocab" | "grammar" | "review" | "story" | "produce" | "exam";

export const PATH_STEPS: PathStep[] = [
  "course",
  "vocab",
  "grammar",
  "review",
  "story",
  "produce",
  "exam",
];

export const STEP_LABEL: Record<PathStep, string> = {
  course: "Cours",
  vocab: "Vocabulaire",
  grammar: "Grammaire",
  review: "Révision",
  story: "Histoire",
  produce: "Produire",
  exam: "Contrôle",
};

/**
 * Étapes de CONTENU NOUVEAU : c'est devant elles qu'une révision s'insère quand le retard
 * monte (§5.4). Le cours n'en fait pas partie — c'est lui qui ouvre la leçon, et le
 * contrôle a sa propre logique (rattrapage).
 */
export const CONTENT_STEPS: ReadonlySet<PathStep> = new Set(["vocab", "grammar", "story", "produce"]);

/** Objectif du jour par défaut, en étapes (§5.1) : environ quinze minutes. */
export const DAILY_STEPS_DEFAULT = 3;

/** Cartes servies par une étape Révision (§5.4). */
export const REVIEW_STEP_SIZE = 10;

/**
 * Au-delà de ce nombre de cartes dues (plus de deux étapes Révision de retard), une
 * révision s'insère avant la prochaine étape de contenu nouveau — au plus une par étape :
 * le retard ralentit le neuf, il ne le gèle jamais.
 */
export const REVIEW_INSERT_THRESHOLD = 2 * REVIEW_STEP_SIZE;

/**
 * Les étapes d'UNE leçon : les sept, moins celles qui n'ont pas de matière. Une leçon sans
 * grammaire saute l'étape Grammaire (et Produire n'y porte que sur les mots) ; une leçon
 * sans vocabulaire, l'étape Vocabulaire.
 */
export function lessonSteps(entry: { introduces: { vocab: string[]; grammar: string[] } }): PathStep[] {
  return PATH_STEPS.filter((s) => {
    if (s === "vocab") return entry.introduces.vocab.length > 0;
    if (s === "grammar") return entry.introduces.grammar.length > 0;
    return true;
  });
}

/** Première étape pas encore faite, dans l'ordre du parcours ; `undefined` = tout est fait. */
export function nextStep(steps: PathStep[], done: ReadonlySet<PathStep>): PathStep | undefined {
  return steps.find((s) => !done.has(s));
}

/** Position 1-indexée d'une étape dans le parcours de sa leçon (« étape 3 / 7 »). */
export function stepNumber(steps: PathStep[], step: PathStep): number {
  return steps.indexOf(step) + 1;
}

/**
 * Un élément de leçon est-il DÉJÀ ACQUIS au moment où son étape s'ouvre ? Carte en état
 * `Review` (rencontré et réussi ailleurs : objectif partagé, mot commun d'une histoire) ou
 * déclaré connu. Les étapes Vocabulaire et Grammaire ne servent que les autres (SPEC §5.6) ;
 * un mot que la révision ne sait pas servir (`isTrainableVocab`) ne les retient pas non plus.
 */
export function isPreAcquiredVocab(v: VocabItem | undefined): boolean {
  if (!v) return false;
  return v.status === "known" || isAcquired(v.card) || !isTrainableVocab(v);
}

export function isPreAcquiredGrammar(g: GrammarItem | undefined): boolean {
  if (!g) return false;
  return g.status === "known" || isAcquired(g.card);
}
