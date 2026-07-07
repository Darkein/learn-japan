import { describe, expect, it } from "vitest";
import { answerVariants, hasKanji, isKanji, kataToHira } from "./kana";

describe("kana", () => {
  it("convertit katakana → hiragana", () => {
    expect(kataToHira("アツイ")).toBe("あつい");
    expect(kataToHira("ニホンゴ")).toBe("にほんご");
    expect(kataToHira("チャ")).toBe("ちゃ");
  });

  it("laisse le hiragana et la ponctuation intacts", () => {
    expect(kataToHira("ねこ、")).toBe("ねこ、");
  });

  it("détecte les kanji", () => {
    expect(isKanji("暑")).toBe(true);
    expect(isKanji("い")).toBe(false);
    expect(hasKanji("暑い")).toBe(true);
    expect(hasKanji("です")).toBe(false);
  });

  describe("answerVariants", () => {
    it("accepte le suffixe optionnel entre parenthèses avec ou sans", () => {
      expect(answerVariants("べんきょう (する)")).toEqual(["べんきょう", "べんきょうする"]);
    });

    it("développe les alternatives séparées par ;", () => {
      expect(answerVariants("いい; よい")).toEqual(["いい", "よい"]);
      expect(answerVariants("足; 脚")).toEqual(["足", "脚"]);
    });

    it("retire le marqueur d'affixe ～", () => {
      expect(answerVariants("～円")).toEqual(["円"]);
      expect(answerVariants("～えん")).toEqual(["えん"]);
    });

    it("combine surface et lecture en dédoublonnant", () => {
      expect(answerVariants("勉強", "べんきょう (する)")).toEqual([
        "勉強",
        "べんきょう",
        "べんきょうする",
      ]);
    });

    it("convertit le katakana et ignore les vides", () => {
      expect(answerVariants("スーパー (マーケット)")).toEqual(["すーぱー", "すーぱーまーけっと"]);
      expect(answerVariants("")).toEqual([]);
    });
  });
});
