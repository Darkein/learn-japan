import { describe, expect, it } from "vitest";
import { particleExercises } from "./exerciseBuild";
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

describe("particleExercises", () => {
  const tokens = [
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞", pos_detail_1: "格助詞" }),
    tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    tok({ surface_form: "を", pos: "助詞", pos_detail_1: "格助詞" }),
  ];
  const exercises = particleExercises(tokens);

  it("génère un exercice choice pour chaque particule, avec 4 choix contenant la réponse", () => {
    const p = exercises.find((e) => e.cloze && e.choices[e.answerIndex] === "が");
    expect(p).toBeDefined();
    expect(p!.choices).toHaveLength(4);
    expect(p!.choices).toContain("が");
    expect(new Set(p!.choices).size).toBe(4); // pas de doublon
  });

  it("n'exige aucun input vide : chaque exercice a un answerIndex valide", () => {
    for (const e of exercises) {
      expect(e.answerIndex).toBeGreaterThanOrEqual(0);
      expect(e.choices[e.answerIndex]).toBeDefined();
    }
  });
});
