// Mots interchangeables : deux entrées du référentiel peuvent porter LE MÊME sens FR
// (しかし / でも « mais, cependant », 切符 / 券 « billet, ticket »). Un exercice FR → japonais
// n'a alors pas de réponse unique : refuser でも parce que la carte tirée est しかし est un
// faux négatif, pas une erreur de l'apprenant.
//
// Deux garde-fous s'appuient sur ce module :
//   - les exercices de rappel isolé (face avant = le sens FR) acceptent AUSSI les mots
//     synonymes (voir alternateAnswers) ;
//   - les QCM de sens n'utilisent jamais un synonyme de la réponse comme distracteur
//     (deux propositions justes rendaient la question insoluble).
//
// La désambiguïsation reste prioritaire : quand deux mots se distinguent réellement, c'est
// la GLOSE qui doit le dire (« chaud (climat) » 暑い vs « doux, tiède (climat) » 暖かい) —
// des gloses différentes ne forment pas un groupe et l'exercice garde sa réponse unique.
// Ce module ne rattrape que les sens qu'aucune glose ne sépare.

import { allVocabInv, canonicalVocabId, type InvVocab } from "./inventory";
import { answerVariants } from "./kana";

/**
 * Clé de regroupement d'un sens FR : casse et espacement normalisés, sens multiples
 * ramenés à un ENSEMBLE trié (« mais, cependant » = « cependant, mais »). Les qualificatifs
 * entre parenthèses sont conservés : ils sont affichés à l'apprenant et sont justement ce
 * qui sépare « chaud (climat) » de « chaud (au toucher) ».
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

/** Sens vide ou non renseigné : jamais regroupé (le tiret est le « pas de sens » de l'UI). */
function isMeaningful(fr: string | undefined): fr is string {
  return !!fr && fr.trim() !== "" && fr.trim() !== "—";
}

const byGloss = ((): Map<string, InvVocab[]> => {
  const map = new Map<string, InvVocab[]>();
  for (const v of allVocabInv()) {
    if (!isMeaningful(v.fr)) continue;
    const key = glossKey(v.fr);
    const bucket = map.get(key);
    if (bucket) bucket.push(v);
    else map.set(key, [v]);
  }
  return map;
})();

/** Entrées du référentiel portant exactement ce sens (au moins celle d'où il vient). */
export function synonymEntries(fr: string): InvVocab[] {
  if (!isMeaningful(fr)) return [];
  return byGloss.get(glossKey(fr)) ?? [];
}

/**
 * Deux sens FR sont-ils interchangeables ? Vrai pour deux libellés qui ne diffèrent que par
 * la casse, l'espacement ou l'ordre des sens. Sert à écarter un distracteur qui serait une
 * seconde bonne réponse dans un QCM de sens.
 */
export function sameMeaning(a: string | undefined, b: string | undefined): boolean {
  if (!isMeaningful(a) || !isMeaningful(b)) return false;
  return glossKey(a) === glossKey(b);
}

/**
 * Réponses supplémentaires à accepter pour un rappel isolé « sens FR → mot japonais » :
 * graphies et lectures des AUTRES mots du référentiel qui portent le même sens. Vide dès
 * que le sens est propre à un seul mot — le cas courant après la passe de désambiguïsation.
 *
 * Réservé aux exercices dont la face avant est le sens seul : un cloze sur une phrase
 * d'exemple ou une dictée attend LE mot de la phrase, pas un synonyme.
 */
export function alternateAnswers(id: string, fr: string | undefined): string[] {
  if (!isMeaningful(fr)) return [];
  const self = canonicalVocabId(id);
  const out: string[] = [];
  for (const entry of synonymEntries(fr)) {
    if (entry.id === self) continue;
    out.push(...answerVariants(entry.ja, entry.yomi ?? entry.ja));
  }
  return [...new Set(out)];
}
