// Distracteurs de particules par ensembles de confusion : particules du même slot
// grammatical, réellement confondues par les apprenants (は/が, に/で, へ/に…) — au lieu
// d'un tirage uniforme dans le pool qui rend le QCM trivial par élimination.

import { shuffle } from "./random";

export const PARTICLE_POOL = ["は", "が", "を", "に", "で", "へ", "と", "も", "から", "まで"];

// Choix des ensembles : distracteurs plausibles dans le même slot, en évitant quand
// possible une alternative qui serait AUSSI correcte dans le cloze (le QCM note par
// index) — d'où は→も plutôt que が en tête, et が→を avant で.
const CONFUSION: Record<string, string[]> = {
  は: ["も", "が", "で"],
  が: ["は", "を", "も"],
  を: ["が", "に", "で"],
  に: ["で", "へ", "まで"],
  で: ["に", "を", "と"],
  へ: ["に", "まで", "から"],
  と: ["に", "も", "で"],
  も: ["は", "が", "と"],
  から: ["まで", "に", "で"],
  まで: ["から", "に", "へ"],
};

/** `n` distracteurs pour la particule `answer` : ensemble de confusion d'abord,
 *  complété au hasard depuis le pool si besoin. Jamais `answer` elle-même. */
export function particleDistractors(answer: string, n = 3): string[] {
  const out = (CONFUSION[answer] ?? []).filter((p) => p !== answer).slice(0, n);
  if (out.length < n) {
    const fill = shuffle(PARTICLE_POOL.filter((p) => p !== answer && !out.includes(p)));
    out.push(...fill.slice(0, n - out.length));
  }
  return out;
}
