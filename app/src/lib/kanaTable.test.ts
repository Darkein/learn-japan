import { describe, expect, it } from "vitest";
import {
  DAKUTEN,
  GOJUON,
  GOJUON_HEADERS,
  YOON,
  YOON_HEADERS,
  kanaKatakana,
  kanaRomaji,
} from "./kanaTable";

function flat(rows: (string | null)[][]): string[] {
  return rows.flat().filter((c): c is string => c !== null);
}

describe("kanaTable", () => {
  it("contient les bons effectifs", () => {
    expect(flat(GOJUON)).toHaveLength(46);
    expect(flat(DAKUTEN)).toHaveLength(25);
    expect(flat(YOON)).toHaveLength(33);
  });

  it("a des rangées de largeur constante", () => {
    for (const row of [...GOJUON, ...DAKUTEN]) {
      expect(row).toHaveLength(GOJUON_HEADERS.length);
    }
    for (const row of YOON) {
      expect(row).toHaveLength(YOON_HEADERS.length);
    }
  });

  it("n'a aucun doublon entre les grilles", () => {
    const all = [...flat(GOJUON), ...flat(DAKUTEN), ...flat(YOON)];
    expect(new Set(all).size).toBe(all.length);
  });

  it("dérive le romaji Hepburn", () => {
    expect(kanaRomaji("あ")).toBe("a");
    expect(kanaRomaji("し")).toBe("shi");
    expect(kanaRomaji("ん")).toBe("n");
    expect(kanaRomaji("ちゃ")).toBe("cha");
    expect(kanaRomaji("ぢ")).toBe("ji");
  });

  it("dérive la forme katakana", () => {
    expect(kanaKatakana("あ")).toBe("ア");
    expect(kanaKatakana("を")).toBe("ヲ");
    expect(kanaKatakana("ぴょ")).toBe("ピョ");
  });
});
