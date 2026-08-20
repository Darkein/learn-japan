// Où se trouve un MOT ENTIER dans une phrase — la brique commune à tout ce qui pose un
// trou (cloze de production/écoute, particule d'un contrôle) ou substitue une lecture
// avant la synthèse vocale.
//
// `String.indexOf` ne suffit pas : le japonais s'écrit sans espaces, une graphie se
// retrouve donc au milieu d'un mot plus long — 日本 dans 日本語, 女 dans 彼女, 八 dans
// 八つ, 青 dans 青い. Masquer une telle occurrence pose une question FAUSSE :
// 「今日、私は◯◯語を勉強します。」 attend 日本（にっぽん）là où la phrase dit
// 日本語（にほんご）. La frontière de mot vient donc du tokenizer, seule autorité —
// aucune règle sur les caractères ne distingue l'okurigana de 青い de la particule de 猫が.

import { isKanji } from "./kana";
import type { KuromojiToken } from "./tokenizer";

/**
 * Offsets de début et de fin de chaque token dans la phrase. Null si les surfaces
 * recollées ne reproduisent PAS `ja` (texte retouché après tokenisation, espaces
 * avalés…) : mieux vaut ne rien conclure que masquer un mauvais segment.
 */
function boundaries(ja: string, tokens: KuromojiToken[]): { starts: Set<number>; ends: Set<number> } | null {
  const starts = new Set<number>();
  const ends = new Set<number>();
  let at = 0;
  for (const t of tokens) {
    starts.add(at);
    at += t.surface_form.length;
    ends.add(at);
  }
  if (at !== ja.length || tokens.map((t) => t.surface_form).join("") !== ja) return null;
  return { starts, ends };
}

/**
 * Positions où `form` apparaît comme UN OU PLUSIEURS TOKENS ENTIERS — l'occurrence
 * commence à une frontière de token et s'arrête sur une autre. Plusieurs tokens sont
 * acceptés parce qu'une graphie du référentiel peut se découper (勉強する → 勉強｜する) ;
 * une occurrence à cheval (日本 dans 日本語) est rejetée, c'est tout l'objet du module.
 * Liste vide si `form` est vide ou si les tokens ne correspondent pas à la phrase.
 */
export function wholeWordIndexes(ja: string, tokens: KuromojiToken[], form: string): number[] {
  if (!form) return [];
  const b = boundaries(ja, tokens);
  if (!b) return [];
  const out: number[] = [];
  for (let i = ja.indexOf(form); i >= 0; i = ja.indexOf(form, i + 1)) {
    if (b.starts.has(i) && b.ends.has(i + form.length)) out.push(i);
  }
  return out;
}

/** Première occurrence mot entier de `form`, ou -1. */
export function wholeWordIndex(ja: string, tokens: KuromojiToken[], form: string): number {
  return wholeWordIndexes(ja, tokens, form)[0] ?? -1;
}

/**
 * Repli SANS tokenizer, réservé aux usages qui ne peuvent pas attendre une tokenisation
 * (substitution de lecture avant la synthèse, cf. exerciseBuild.sentenceSpeechText) :
 * occurrences qui ne sont pas SOUDÉES à un kanji voisin. Volontairement plus prudent que
 * `wholeWordIndexes` — il laisse passer un okurigana (青 dans 青い) mais jamais un composé
 * de kanji (日本 dans 日本語, 女 dans 彼女), et ses faux négatifs ne coûtent rien à l'appelant
 * visé : sur 一日中, laisser 一日 en kanji fait justement lire いちにちじゅう au moteur.
 */
export function unfusedIndexes(ja: string, form: string): number[] {
  if (!form) return [];
  const out: number[] = [];
  for (let i = ja.indexOf(form); i >= 0; i = ja.indexOf(form, i + 1)) {
    const before = i > 0 ? ja[i - 1] : "";
    const after = ja[i + form.length] ?? "";
    const fusedLeft = !!before && isKanji(before) && isKanji(form[0]);
    const fusedRight = !!after && isKanji(after) && isKanji(form[form.length - 1]);
    if (!fusedLeft && !fusedRight) out.push(i);
  }
  return out;
}

/** Remplace `[index, index + length)` par `replacement` — le reste de la phrase intact. */
export function spliceAt(ja: string, index: number, length: number, replacement: string): string {
  return ja.slice(0, index) + replacement + ja.slice(index + length);
}

/** Remplace toutes les positions données (longueur commune `length`), de droite à gauche. */
export function spliceAll(ja: string, indexes: number[], length: number, replacement: string): string {
  return [...indexes]
    .sort((a, b) => b - a)
    .reduce((s, i) => spliceAt(s, i, length, replacement), ja);
}
