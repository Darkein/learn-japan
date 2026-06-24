// Chargeurs des données de référence.
// - Gloss littéral : sous-ensemble JMdict-FR committé (POC ; pipeline complet via scripts).
// - Kanji : inventaire complet (app/src/data/inventory/kanji.json), produit par
//   `npm run data:inventory` depuis kanji-data (KANJIDIC + niveaux JLPT). Sens FR prioritaire.

import jmdictSample from "../data/jmdict-sample.json";
import kanjiInv from "../data/inventory/kanji.json";
import type { ContentDict } from "./gloss";

export interface KanjiInfo {
  kanji: string;
  meanings: string[];
  on: string[];
  kun: string[];
  jlpt: number | null;
}

interface KanjiInvEntry {
  id: string;
  level: number;
  fr?: string;
  meanings: string[];
  on: string[];
  kun: string[];
}

/** Dictionnaire de contenu (forme de base → gloss français) pour le gloss littéral. */
export const contentDict: ContentDict = jmdictSample as ContentDict;

const kanjiIndex: Map<string, KanjiInfo> = new Map(
  (kanjiInv as KanjiInvEntry[]).map((k) => [
    k.id,
    {
      kanji: k.id,
      // sens FR curé en tête (sinon repli sur les sens anglais de l'inventaire)
      meanings: k.fr ? [k.fr, ...k.meanings] : k.meanings,
      on: k.on,
      kun: k.kun,
      jlpt: k.level,
    },
  ]),
);

/** Infos d'un kanji isolé (composition/lectures viennent plus tard de KanjiDic/KRADFILE). */
export function lookupKanji(ch: string): KanjiInfo | undefined {
  return kanjiIndex.get(ch);
}
