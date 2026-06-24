import { describe, expect, it } from "vitest";
import { hasKanji, isKanji, kataToHira } from "./kana";

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
});
