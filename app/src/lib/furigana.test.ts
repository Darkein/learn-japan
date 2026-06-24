import { describe, expect, it } from "vitest";
import { fitFurigana } from "./furigana";

describe("fitFurigana", () => {
  it("attache la lecture au kanji et laisse l'okurigana en clair (暑い)", () => {
    expect(fitFurigana("暑い", "アツイ")).toEqual([
      { base: "暑", ruby: "あつ" },
      { base: "い" },
    ]);
  });

  it("gère l'okurigana en suffixe (食べる)", () => {
    expect(fitFurigana("食べる", "タベル")).toEqual([
      { base: "食", ruby: "た" },
      { base: "べる" },
    ]);
  });

  it("gère le kana en préfixe (お茶)", () => {
    expect(fitFurigana("お茶", "オチャ")).toEqual([
      { base: "お" },
      { base: "茶", ruby: "ちゃ" },
    ]);
  });

  it("met toute la lecture en ruby pour un bloc 100% kanji (日本語)", () => {
    expect(fitFurigana("日本語", "ニホンゴ")).toEqual([
      { base: "日本語", ruby: "にほんご" },
    ]);
  });

  it("aligne plusieurs runs de kanji (持ち運ぶ)", () => {
    expect(fitFurigana("持ち運ぶ", "モチハコブ")).toEqual([
      { base: "持", ruby: "も" },
      { base: "ち" },
      { base: "運", ruby: "はこ" },
      { base: "ぶ" },
    ]);
  });

  it("ne touche pas un mot sans kanji", () => {
    expect(fitFurigana("です", "デス")).toEqual([{ base: "です" }]);
  });

  it("repli : ruby global si la lecture n'aligne pas", () => {
    expect(fitFurigana("今日", "きょう")).toEqual([{ base: "今日", ruby: "きょう" }]);
  });
});
