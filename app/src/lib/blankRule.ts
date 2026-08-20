// Quelle RÈGLE de grammaire commande la forme attendue dans un trou d'exercice ? « し »
// dans 「勉強◯◯ます。」 n'est pas する par caprice : c'est le radical qu'exige ます. La
// correction peut donc nommer la règle plutôt que laisser deviner pourquoi la carte する
// se répond し.
//
// Table FIXE des terminaisons vers le référentiel de grammaire (lib/inventory.ts) : c'est
// de la grammaire, il y a une bonne réponse — pas de LLM (même parti que lib/particles.ts).
// La règle cherchée est celle qui SUIT le trou : le trou ne porte que le radical, la
// terminaison reste dans la phrase. C'est ce qui rend la table courte et juste — 「してから」
// masque し devant て, et la て-forme est bien la règle qui produit ce radical, quelle que
// soit la construction bâtie dessus ensuite (てから, てもいい, てしまう…).

import { grammarDetail } from "./inventory";

/** Règle affichée sous la réponse d'un trou. */
export interface BlankRule {
  /** Point de grammaire du référentiel (« ます (poli) »). */
  name: string;
  /** Sa règle en une phrase, en français. */
  rule: string;
}

/**
 * Terminaisons reconnues → point de grammaire, de la PLUS LONGUE à la plus courte :
 * ませんでした doit gagner contre ません, ています contre て. Les constructions bâties sur la
 * て-forme ou sur la base en ます ne sont PAS listées : leur radical s'explique par て / ます,
 * qui les couvre toutes (cf. l'en-tête).
 */
const ENDING_RULES: [ending: string, grammarId: string][] = [
  ["ませんでした", "n5-masen-deshita"],
  ["ましょう", "n5-mashou"],
  ["ません", "n5-masen-negative"],
  ["ました", "n5-mashita-past"],
  ["ます", "n5-masu-polite"],
  ["たい", "n5-tai-want"],
  ["てください", "n5-te-kudasai"],
  ["ています", "n5-teiru-progressive"],
  ["ている", "n5-teiru-progressive"],
  ["ていた", "n5-teiru-progressive"],
  ["て", "n5-te-form"],
  // Radical en ん/っ : la て-forme et le passé neutre se sonorisent (読んで, 読んだ).
  ["で", "n5-te-form"],
  ["なかっ", "n5-nai-negative"],
  ["ない", "n5-nai-negative"],
  ["た", "n5-ta-past"],
  ["だ", "n5-ta-past"],
];

/**
 * Règle qui commande la forme du trou, d'après le radical masqué et ce qui le suit dans la
 * phrase. Null quand rien de connu ne suit (le trou ne s'explique alors pas en une ligne :
 * mieux vaut ne rien dire que nommer une règle au hasard).
 */
export function blankRuleFor(form: string, after: string): BlankRule | null {
  const id = ruleIdFor(form, after);
  const g = id ? grammarDetail(id) : null;
  return g ? { name: g.name, rule: g.ruleFr } : null;
}

function ruleIdFor(form: string, after: string): string | null {
  // L'adjectif en -い a ses propres règles : 暑く + ない n'est pas la négation d'un VERBE,
  // et 暑かっ + た n'est pas le passé neutre d'un verbe.
  if (form.endsWith("く") && after.startsWith("ない")) return "n5-iadj-negative";
  if (form.endsWith("かっ") && after.startsWith("た")) return "n5-iadj-past";
  return ENDING_RULES.find(([ending]) => after.startsWith(ending))?.[1] ?? null;
}
