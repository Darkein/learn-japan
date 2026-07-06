// Distracteurs de particules par ensembles de confusion : particules du même slot
// grammatical, réellement confondues par les apprenants (は/が, に/で, へ/に…) — au lieu
// d'un tirage uniforme dans le pool qui rend le QCM trivial par élimination.

import { shuffle } from "./random";

export const PARTICLE_POOL = ["は", "が", "を", "に", "で", "へ", "と", "も", "から", "まで"];

// Choix des ensembles : distracteurs plausibles dans le même slot, en évitant quand
// possible une alternative qui serait AUSSI correcte dans le cloze (le QCM note par
// index) — d'où が→を avant で.
const CONFUSION: Record<string, string[]> = {
  は: ["も", "を", "で"],
  が: ["を", "も", "で"],
  を: ["に", "で", "へ"],
  に: ["で", "へ", "まで"],
  で: ["に", "を", "と"],
  へ: ["に", "まで", "から"],
  と: ["に", "も", "で"],
  も: ["を", "に", "と"],
  から: ["まで", "に", "で"],
  まで: ["から", "に", "へ"],
};

// Particules INTERCHANGEABLES dans un même énoncé simple : は et が marquent tous deux le
// sujet dans « 猫は水を飲む / 猫が水を飲む » (thème vs sujet). Les proposer ensemble crée un
// QCM piégeux (les deux « fonctionnent »). On ne présente donc JAMAIS l'une comme
// distracteur de l'autre — une seule des deux apparaît par question.
const EQUIVALENTS: Record<string, string[]> = {
  は: ["が"],
  が: ["は"],
};

/** `n` distracteurs pour la particule `answer` : ensemble de confusion d'abord,
 *  complété au hasard depuis le pool si besoin. Jamais `answer` ni une particule
 *  interchangeable avec elle (は/が). */
export function particleDistractors(answer: string, n = 3): string[] {
  const banned = new Set<string>([answer, ...(EQUIVALENTS[answer] ?? [])]);
  const out = (CONFUSION[answer] ?? []).filter((p) => !banned.has(p)).slice(0, n);
  if (out.length < n) {
    const fill = shuffle(PARTICLE_POOL.filter((p) => !banned.has(p) && !out.includes(p)));
    out.push(...fill.slice(0, n - out.length));
  }
  return out;
}
