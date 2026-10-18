// Les mots de la voie (SPEC §5c.2) : chaque nœud a son kanji-icône, et un vrai mot avec sa
// lecture en kana, pour pouvoir le dire sans connaître le kanji.

import type { PathStep } from "../../lib/path";
import type { ExtraKind, TrackCity } from "../../lib/track";

export interface NodeWord {
  /** Kanji de l'icône (le sceau). */
  icon: string;
  /** Le mot japonais du libellé, et sa lecture. */
  word: string;
  kana: string;
  /** Nom français. */
  fr: string;
}

export const STEP_WORDS: Record<PathStep, NodeWord> = {
  course: { icon: "講", word: "講義", kana: "こうぎ", fr: "Cours" },
  vocab: { icon: "語", word: "語彙", kana: "ごい", fr: "Vocabulaire" },
  grammar: { icon: "文", word: "文法", kana: "ぶんぽう", fr: "Grammaire" },
  review: { icon: "復", word: "復習", kana: "ふくしゅう", fr: "Révision" },
  story: { icon: "話", word: "話", kana: "はなし", fr: "Histoire" },
  produce: { icon: "書", word: "書く", kana: "かく", fr: "Produire" },
  exam: { icon: "関", word: "関所", kana: "せきしょ", fr: "Contrôle" },
};

export const EXTRA_WORDS: Record<ExtraKind, NodeWord> = {
  "inserted-review": { icon: "復", word: "復習", kana: "ふくしゅう", fr: "Révision insérée" },
  "targeted-review": { icon: "復", word: "復習", kana: "ふくしゅう", fr: "Révision ciblée" },
  rest: { icon: "休", word: "休憩", kana: "きゅうけい", fr: "Station de repos" },
  "free-review": { icon: "復", word: "復習", kana: "ふくしゅう", fr: "Révision" },
};

/** Lecture des noms de route (data/routes.ts `kanji`), par niveau. */
export const ROUTE_KANA: Record<number, string> = {
  5: "とうかいどう",
  4: "こうしゅうかいどう",
  3: "なかせんどう",
  2: "おくのほそみち",
  1: "しこくへんろ",
};

/** Kanji des départs et terminus des cinq routes. */
const ENDPOINT_GLYPH: Record<string, string> = {
  Nihonbashi: "橋",
  "Sanjō Ōhashi": "京",
  Shimosuwa: "諏",
  Fukagawa: "深",
  Ōgaki: "垣",
  "Ryōzen-ji": "寺",
  "Ōkubo-ji": "寺",
};

/** Le kanji au cœur du nœud d'une ville, selon sa taille (SPEC §5c.4). */
export function cityGlyph(city: TrackCity): string {
  if (city.glyph) return city.glyph;
  switch (city.size) {
    case "village":
      return "村";
    case "ville":
      return "宿";
    case "grande":
      return "城";
    case "terminus":
      return ENDPOINT_GLYPH[city.romaji] ?? city.kanji[0];
  }
}

/** Angle stable d'un sceau tamponné, entre −8° et +8° (même étape, même angle). */
export function sealAngle(n: number): number {
  return ((n * 37) % 17) - 8;
}
