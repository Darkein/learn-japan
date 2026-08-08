// Deux mots ne doivent jamais porter le même sens FR : un exercice « sens FR → mot japonais »
// n'aurait pas de réponse unique, et une réponse juste sur deux serait comptée fausse (暑い et
// 暖かい tous deux glosés « chaud (climat) »).
//
// La réponse à ça est la GLOSE, pas la tolérance : c'est le libellé qui doit dire ce qui
// distingue les deux mots — registre, domaine, lecture, nature (« doux, tiède (climat) »,
// « cependant, toutefois (écrit ou formel) » face à « mais (courant, à l'oral) »). Accepter
// les deux mots enseignerait qu'ils sont interchangeables, ce qu'ils ne sont pas. L'invariant
// « aucune glose partagée » est vérifié sur tout le référentiel par synonyms.test.ts.
//
// Reste un cas que la curation ne couvre pas : les mots HORS référentiel rencontrés dans une
// histoire, glosés par le JMdict, où deux entrées peuvent tomber sur le même libellé. Un QCM
// de sens y proposerait deux bonnes réponses — insoluble, pas seulement indulgent. D'où le
// garde-fou ci-dessous, utilisé pour écarter un distracteur synonyme de la réponse.

/**
 * Clé de comparaison d'un sens FR : casse et espacement normalisés, sens multiples ramenés à
 * un ENSEMBLE trié (« mais, cependant » = « cependant, mais »). Les qualificatifs entre
 * parenthèses sont conservés : ils sont affichés à l'apprenant et sont justement ce qui sépare
 * « chaud (climat) » de « chaud (au toucher) ».
 */
export function glossKey(fr: string): string {
  const parts = fr
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/[;,]/)
    .map((p) => p.replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, ""))
    .filter(Boolean);
  return [...new Set(parts)].sort().join("|");
}

/** Sens vide ou non renseigné : jamais rapproché d'un autre (le tiret est le « pas de sens » de l'UI). */
function isMeaningful(fr: string | undefined): fr is string {
  return !!fr && fr.trim() !== "" && fr.trim() !== "—";
}

/**
 * Deux sens FR désignent-ils la même chose ? Vrai pour deux libellés qui ne diffèrent que par
 * la casse, l'espacement ou l'ordre des sens. Sert à écarter un distracteur qui serait une
 * seconde bonne réponse dans un QCM de sens.
 */
export function sameMeaning(a: string | undefined, b: string | undefined): boolean {
  if (!isMeaningful(a) || !isMeaningful(b)) return false;
  return glossKey(a) === glossKey(b);
}
