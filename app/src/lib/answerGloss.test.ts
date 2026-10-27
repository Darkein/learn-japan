import { describe, expect, it } from "vitest";
import { glossAnswer, type GlossSources } from "./answerGloss";

const src: GlossSources = {
  words: [
    { surface: "猫", reading: "ねこ", fr: "chat" },
    { surface: "犬", reading: "いぬ", fr: "chien" },
    { surface: "食べる", reading: "たべる", fr: "manger" },
    { surface: "いい; よい", reading: "いい; よい", fr: "bon" },
    { surface: "謎", reading: "なぞ", fr: "—" },
  ],
  dict: { "なぞ": "énigme", "さかな": "poisson" },
  baseForm: async (t) => (t === "食べた" ? "食べる" : null),
};

describe("glossAnswer — sens de la réponse donnée", () => {
  it("trouve un mot tapé en kana, avec sa graphie", async () => {
    expect(await glossAnswer("ねこ", src)).toEqual({ ja: "猫", reading: "ねこ", fr: "chat" });
  });

  it("compare en hiragana : ネコ vaut ねこ", async () => {
    expect((await glossAnswer("ネコ", src))?.fr).toBe("chat");
  });

  it("trouve un mot choisi en kanji", async () => {
    expect((await glossAnswer("犬", src))?.fr).toBe("chien");
  });

  it("matche chaque forme d'une entrée composée", async () => {
    expect(await glossAnswer("よい", src)).toEqual({ ja: "いい", reading: undefined, fr: "bon" });
  });

  it("se replie sur le JMdict, et ignore un sens vide (—)", async () => {
    expect(await glossAnswer("さかな", src)).toEqual({ ja: "さかな", fr: "poisson" });
    expect(await glossAnswer("なぞ", src)).toEqual({ ja: "なぞ", fr: "énigme" });
  });

  it("ramène une forme conjuguée à sa forme de dictionnaire", async () => {
    expect((await glossAnswer("食べた", src))?.fr).toBe("manger");
  });

  it("donne le mot désigné par un sens français", async () => {
    expect(await glossAnswer("chien", src)).toEqual({ ja: "犬", reading: "いぬ", fr: "chien" });
  });

  it("null pour une réponse inconnue ou vide", async () => {
    expect(await glossAnswer("ぬぬぬ", src)).toBeNull();
    expect(await glossAnswer("girafe", src)).toBeNull();
    expect(await glossAnswer("  ", src)).toBeNull();
  });
});
