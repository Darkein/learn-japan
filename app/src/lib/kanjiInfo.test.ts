import { describe, expect, it } from "vitest";
import type { ItemStatus } from "./db";
import {
  kanjiBreakdown,
  kanjiIn,
  relatedWords,
  vocabWithKanji,
  wordKanjiReadings,
} from "./kanjiInfo";
import { kanjiDetail } from "./inventory";

describe("kanjiIn", () => {
  it("extrait les kanji dans l'ordre d'apparition", () => {
    expect(kanjiIn("日本語")).toEqual(["日", "本", "語"]);
  });

  it("dédoublonne les répétitions", () => {
    expect(kanjiIn("日曜日")).toEqual(["日", "曜"]);
  });

  it("ignore kana et latin", () => {
    expect(kanjiIn("たべる")).toEqual([]);
    expect(kanjiIn("abc")).toEqual([]);
    expect(kanjiIn("食べる")).toEqual(["食"]);
  });
});

describe("kanjiBreakdown", () => {
  it("résout un mot N5 avec sens français et niveau", () => {
    const items = kanjiBreakdown("食べる");
    expect(items).toHaveLength(1);
    expect(items[0].ja).toBe("食");
    expect(items[0].fr).not.toBe("");
    expect(items[0].level).toBe(5);
  });

  it("omet sans erreur les caractères hors inventaire (々)", () => {
    const items = kanjiBreakdown("時々");
    expect(items.map((k) => k.ja)).toEqual(["時"]);
  });

  it("vide pour un mot sans kanji", () => {
    expect(kanjiBreakdown("これ")).toEqual([]);
  });
});

/**
 * La rangée « Kanji du mot » ne montre que quelques lectures : elles doivent être celles du
 * mot ouvert, pas les premières du référentiel. C'est ce tri qui empêche la fiche de ぬるい
 * de n'afficher que les lectures de あたたかい — les deux mots partageant 温.
 */
describe("wordKanjiReadings", () => {
  const on = kanjiDetail("温")!;

  it("place en tête la lecture à l'œuvre dans le mot", () => {
    expect(wordKanjiReadings(on, "温かい", "あたたかい")[0]).toBe("あたた.かい");
  });

  it("remonte la lecture on d'un composé, que la troncature coupait", () => {
    const sei = kanjiDetail("生")!;
    expect(wordKanjiReadings(sei, "学生", "がくせい")[0]).toBe("せい");
    // Ce que montrait l'ancien affichage (4 premières du référentiel) : aucune lecture du mot.
    expect([...sei.kun, ...sei.on].slice(0, 4)).not.toContain("せい");
  });

  it("tolère le rendaku et la gémination d'un composé", () => {
    expect(wordKanjiReadings(kanjiDetail("社")!, "神社", "じんじゃ")[0]).toBe("しゃ");
    expect(wordKanjiReadings(kanjiDetail("回")!, "一回", "いっかい")[0]).toBe("かい");
  });

  it("récupère par l'okurigana une lecture absente du dataset (温い → ぬる)", () => {
    const readings = wordKanjiReadings(on, "温い", "ぬるい");
    expect(readings[0]).toBe("ぬる");
    expect(on.kun).not.toContain("ぬる");
    // Les lectures du dictionnaire suivent, aucune n'est perdue.
    expect(readings.slice(1)).toEqual([...on.kun, ...on.on]);
  });

  it("laisse l'ordre du référentiel sans lecture, ou si rien ne s'aligne", () => {
    const all = [...on.kun, ...on.on];
    expect(wordKanjiReadings(on, "温い")).toEqual(all);
    // 大人 (おとな) : lecture du MOT, non répartissable sur ses kanji.
    const dai = kanjiDetail("大")!;
    expect(wordKanjiReadings(dai, "大人", "おとな")).toEqual([...dai.kun, ...dai.on]);
  });

  it("accepte une lecture en katakana", () => {
    expect(wordKanjiReadings(on, "温かい", "アタタカイ")[0]).toBe("あたた.かい");
  });
});

describe("vocabWithKanji", () => {
  it("liste des mots contenant le kanji, N5 en tête", () => {
    const words = vocabWithKanji("日");
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((v) => v.ja.includes("日"))).toBe(true);
    // allVocabInv() trie par niveau décroissant (N5=5 → N1=1) ; l'index en hérite.
    for (let i = 1; i < words.length; i++) {
      expect(words[i - 1].level).toBeGreaterThanOrEqual(words[i].level);
    }
  });

  it("vide pour un caractère inconnu", () => {
    expect(vocabWithKanji("〆")).toEqual([]);
  });
});

describe("relatedWords", () => {
  it("partitionne connus/à réviser vs suggestions, avec le statut résolu", () => {
    const all = vocabWithKanji("日");
    const statuses = new Map<string, ItemStatus>([
      [all[0].id, "known"],
      [all[1].id, "review"],
      [all[2].id, "unknown"],
    ]);
    const { known, suggestions } = relatedWords("日", statuses);
    expect(known.map((k) => k.word.id)).toEqual([all[0].id, all[1].id]);
    expect(known.map((k) => k.status)).toEqual(["known", "review"]);
    expect(suggestions.map((v) => v.id)).toContain(all[2].id);
    expect(known.length + suggestions.length).toBe(all.length);
  });

  it("exclut le mot d'origine", () => {
    const all = vocabWithKanji("日");
    const { known, suggestions } = relatedWords("日", new Map(), all[0].id);
    expect(known).toEqual([]);
    expect(suggestions.map((v) => v.id)).not.toContain(all[0].id);
    expect(suggestions.length).toBe(all.length - 1);
  });

  it("tout en suggestions quand aucun statut", () => {
    const { known, suggestions } = relatedWords("日", new Map());
    expect(known).toEqual([]);
    expect(suggestions.length).toBe(vocabWithKanji("日").length);
  });

  // L'inventaire annote certaines lectures (« 勉強|べんきょう (する) ») alors que
  // le lecteur produit des ids token nus (« 勉強|べんきょう ») : les deux espaces
  // d'ids doivent se rejoindre.
  it("réconcilie un id token du lecteur avec la lecture annotée de l'inventaire", () => {
    const statuses = new Map<string, ItemStatus>([["勉強|べんきょう", "known"]]);
    const { known } = relatedWords("勉", statuses);
    const hit = known.find((k) => k.word.ja === "勉強");
    expect(hit).toBeDefined();
    expect(hit?.status).toBe("known");
  });

  it("exclut le mot d'origine malgré une lecture annotée dans l'inventaire", () => {
    const { known, suggestions } = relatedWords("勉", new Map(), "勉強|べんきょう");
    expect(known.map((k) => k.word.ja)).not.toContain("勉強");
    expect(suggestions.map((v) => v.ja)).not.toContain("勉強");
  });
});
