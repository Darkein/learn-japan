import { describe, expect, it } from "vitest";
import { buildQuiz, type ParticleQ } from "./quiz";
import type { KuromojiToken } from "./tokenizer";

function tok(p: Partial<KuromojiToken> & { surface_form: string; pos: string }): KuromojiToken {
  return {
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: p.surface_form,
    ...p,
  };
}

describe("buildQuiz", () => {
  const tokens = [
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞", pos_detail_1: "格助詞" }),
    tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    tok({ surface_form: "を", pos: "助詞", pos_detail_1: "格助詞" }),
  ];
  const qs = buildQuiz(tokens);

  it("génère une question de particule avec 4 choix contenant la réponse", () => {
    const p = qs.find((q): q is ParticleQ => q.kind === "particle" && q.answer === "が");
    expect(p).toBeDefined();
    expect(p!.choices).toHaveLength(4);
    expect(p!.choices).toContain("が");
    expect(new Set(p!.choices).size).toBe(4); // pas de doublon
  });
});
