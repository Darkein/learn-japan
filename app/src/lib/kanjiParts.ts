// Composition d'un kanji : de quelles PARTIES son tracé est fait (見 = 目 sur 儿).
// À ne pas confondre avec kanjiInfo.ts, qui décompose un MOT en kanji — ici on descend
// d'un cran, du kanji vers ses composants.
//
// Corpus : kanji-parts.json, extrait de KanjiVG par scripts/build-kanji-parts.ts. Un kanji
// n'y figure que si sa composition est COMPLÈTE (cf. l'invariant du script) : l'absence
// d'entrée est donc un « on ne sait pas », pas un « ce kanji est simple ».
//
// Import STATIQUE (≈ 110 Ko, rangés dans le chunk `inventory` par vite.config.ts) : la
// lecture est synchrone, la fiche kanji n'a pas de section qui apparaît après coup. Si le
// chunk devenait trop lourd, le repli est l'import dynamique de lib/mnemonics.ts.

import partsInv from "../data/inventory/kanji-parts.json";
import partsFr from "../data/inventory/kanji-parts-fr.json";
import { kanjiDetail } from "./inventory";

/** Forme brute d'une partie dans kanji-parts.json (champs courts). */
interface RawPart {
  c: string;
  base?: string;
  rad?: number;
  phon?: number;
}

interface RawEntry {
  p: RawPart[];
  self?: number;
}

/** Une partie du tracé, prête à afficher. */
export interface KanjiPart {
  /** Glyphe de la partie, tel qu'il apparaît dans le tracé (亻, 目, 吾). */
  ja: string;
  /** Sens français, vide si on ne le connaît pas (on affiche alors le glyphe seul). */
  fr: string;
  /** Cette partie est LE radical du kanji. */
  radical: boolean;
  /** Cette partie donne la lecture on du kanji. */
  phonetic: boolean;
}

const parts = partsInv as Record<string, RawEntry>;
const glosses = partsFr as Record<string, string>;

/**
 * Sens d'une partie. Priorité à l'inventaire — la moitié des composants sont eux-mêmes des
 * kanji N5–N1, dont le sens est CURÉ (kanji-fr.json) : un corpus généré ne doit jamais
 * passer devant. Les variantes graphiques (亻, 艹, 氵) résolvent par leur forme de base.
 * À défaut, le corpus généré (kanji-parts-fr.json), puis rien.
 */
function partGloss(part: RawPart): string {
  const base = part.base ?? part.c;
  return kanjiDetail(base)?.fr ?? glosses[part.c] ?? glosses[base] ?? "";
}

/** Parties d'un kanji, dans l'ordre du tracé. Vide si sa composition n'est pas connue. */
export function kanjiParts(ch: string): KanjiPart[] {
  const entry = parts[ch];
  if (!entry) return [];
  return entry.p.map((part) => ({
    ja: part.c,
    fr: partGloss(part),
    radical: part.rad === 1,
    phonetic: part.phon === 1,
  }));
}

/**
 * Le kanji est lui-même un radical (見, 車, 目…). Aucune de ses parties n'est alors marquée
 * comme radical : le dire évite de laisser croire à un oubli.
 */
export function isSelfRadical(ch: string): boolean {
  return parts[ch]?.self === 1;
}

/** Composition résumée en une ligne : « 目 œil + 儿 jambes ». Vide si inconnue. */
export function partsSummary(ch: string): string {
  return kanjiParts(ch)
    .map((p) => (p.fr ? `${p.ja} ${p.fr}` : p.ja))
    .join(" + ");
}
