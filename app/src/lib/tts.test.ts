import { describe, expect, it } from "vitest";
import type { AnnotatedToken } from "./furigana";
import { splitSentences } from "./tts";

// Seul `.surface` est lu par splitSentences → tokens minimaux suffisants.
function toks(...surfaces: string[]): AnnotatedToken[] {
  return surfaces.map((surface) => ({ surface }) as AnnotatedToken);
}

describe("splitSentences", () => {
  it("coupe après une ponctuation finale et conserve l'index global", () => {
    const sentences = splitSentences(toks("猫", "は", "寝る", "。", "犬", "も", "寝る", "。"));
    expect(sentences).toHaveLength(2);
    expect(sentences[0].baseIndex).toBe(0);
    expect(sentences[0].text).toBe("猫は寝る。");
    expect(sentences[1].baseIndex).toBe(4); // le 1er token de la 2e phrase est le 5e global
    expect(sentences[1].text).toBe("犬も寝る。");
  });

  it("émet une dernière phrase même sans ponctuation finale", () => {
    const sentences = splitSentences(toks("これ", "は", "本"));
    expect(sentences).toHaveLength(1);
    expect(sentences[0].text).toBe("これは本");
  });

  it("ignore le texte vide / purement blanc", () => {
    expect(splitSentences(toks(" ", "\n"))).toHaveLength(0);
    expect(splitSentences([])).toHaveLength(0);
  });

  it("gère les ponctuations ！ ？ et !", () => {
    const sentences = splitSentences(toks("すごい", "！", "本当", "？"));
    expect(sentences.map((s) => s.text)).toEqual(["すごい！", "本当？"]);
  });
});
