// Chargeurs des données de référence. En Phase 0 : sous-ensembles committés (POC).
// Le pipeline complet (KanjiDic2 / JMdict-fr) est produit par les scripts dans /scripts
// et chargé à la demande dans une phase ultérieure.

import jmdictSample from "../data/jmdict-sample.json";
import kanjiSample from "../data/kanji-sample.json";
import type { ContentDict } from "./gloss";

export interface KanjiInfo {
  kanji: string;
  meanings: string[];
  on: string[];
  kun: string[];
  jlpt: number | null;
}

/** Dictionnaire de contenu (forme de base → gloss français) pour le gloss littéral. */
export const contentDict: ContentDict = jmdictSample as ContentDict;

const kanjiIndex: Map<string, KanjiInfo> = new Map(
  (kanjiSample as KanjiInfo[]).map((k) => [k.kanji, k]),
);

/** Infos d'un kanji isolé (composition/lectures viennent plus tard de KanjiDic/KRADFILE). */
export function lookupKanji(ch: string): KanjiInfo | undefined {
  return kanjiIndex.get(ch);
}
