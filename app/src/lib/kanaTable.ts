// Grilles du tableau des kanas (catalogue). Hiragana seul en données :
// katakana et romaji sont dérivés via wanakana.

import { toKatakana, toRomaji } from "wanakana";

/** Cellule du tableau : hiragana, ou null pour une case vide (yi/ye/wu…). */
export type KanaCell = string | null;

/** Gojūon — 46 kana de base, 5 colonnes (a i u e o), ん en dernière rangée. */
export const GOJUON: KanaCell[][] = [
  ["あ", "い", "う", "え", "お"],
  ["か", "き", "く", "け", "こ"],
  ["さ", "し", "す", "せ", "そ"],
  ["た", "ち", "つ", "て", "と"],
  ["な", "に", "ぬ", "ね", "の"],
  ["は", "ひ", "ふ", "へ", "ほ"],
  ["ま", "み", "む", "め", "も"],
  ["や", null, "ゆ", null, "よ"],
  ["ら", "り", "る", "れ", "ろ"],
  ["わ", null, null, null, "を"],
  ["ん", null, null, null, null],
];

/** Dakuten / handakuten — 25 kana, 5 colonnes. */
export const DAKUTEN: KanaCell[][] = [
  ["が", "ぎ", "ぐ", "げ", "ご"],
  ["ざ", "じ", "ず", "ぜ", "ぞ"],
  ["だ", "ぢ", "づ", "で", "ど"],
  ["ば", "び", "ぶ", "べ", "ぼ"],
  ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"],
];

/** Yōon — 33 combinaisons usuelles, 3 colonnes (ya yu yo). ぢゃ/ぢゅ/ぢょ omis. */
export const YOON: KanaCell[][] = [
  ["きゃ", "きゅ", "きょ"],
  ["しゃ", "しゅ", "しょ"],
  ["ちゃ", "ちゅ", "ちょ"],
  ["にゃ", "にゅ", "にょ"],
  ["ひゃ", "ひゅ", "ひょ"],
  ["みゃ", "みゅ", "みょ"],
  ["りゃ", "りゅ", "りょ"],
  ["ぎゃ", "ぎゅ", "ぎょ"],
  ["じゃ", "じゅ", "じょ"],
  ["びゃ", "びゅ", "びょ"],
  ["ぴゃ", "ぴゅ", "ぴょ"],
];

export const GOJUON_HEADERS = ["a", "i", "u", "e", "o"];
export const YOON_HEADERS = ["ya", "yu", "yo"];

/** Romaji Hepburn d'un kana (wanakana gère les irréguliers : し→shi, ちゃ→cha, ん→n). */
export function kanaRomaji(hira: string): string {
  return toRomaji(hira);
}

/** Forme katakana d'un kana hiragana. */
export function kanaKatakana(hira: string): string {
  return toKatakana(hira);
}
