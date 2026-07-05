// Détection de "presque juste" en saisie : distance de Damerau-Levenshtein ≤ 1
// (substitution, insertion, suppression ou transposition adjacente) sur des chaînes
// déjà normalisées en hiragana (voir normalizeReading). Une coquille est notée
// "hard", jamais "good" — les paires minimales kana (かき/かぎ) restent pénalisées.

/** Longueur minimale de la réponse attendue pour tolérer une coquille : en dessous,
 *  une édition change trop souvent le mot en un autre mot valide. */
const MIN_ANSWER_LENGTH = 3;

/** Vrai si `entry` diffère de `answer` d'exactement UNE édition (Damerau-Levenshtein). */
export function isNearMiss(entry: string, answer: string): boolean {
  if (answer.length < MIN_ANSWER_LENGTH) return false;
  if (entry === answer) return false; // égalité = correct, pas une coquille
  if (Math.abs(entry.length - answer.length) > 1) return false;

  let i = 0;
  const la = entry.length;
  const lb = answer.length;
  while (i < la && i < lb && entry[i] === answer[i]) i++;

  if (la === lb) {
    // Substitution en i…
    if (entry.slice(i + 1) === answer.slice(i + 1)) return true;
    // …ou transposition adjacente en i.
    return (
      i + 1 < la &&
      entry[i] === answer[i + 1] &&
      entry[i + 1] === answer[i] &&
      entry.slice(i + 2) === answer.slice(i + 2)
    );
  }

  // Longueurs ±1 : la plus longue saute le caractère en i (insertion/suppression).
  const [long, short] = la > lb ? [entry, answer] : [answer, entry];
  return long.slice(i + 1) === short.slice(i);
}
