import { describe, expect, it, vi } from "vitest";
import type { ComprehensionItem, GrammarItem } from "./db";
import { comprehensionReviewExercise, grammarReviewExercise } from "./exerciseBuild";
import type { KuromojiToken } from "./tokenizer";

// Simule le tokenizer (kuromoji ne tourne pas en node) — même approche que enroll.test.ts.
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> => {
    const mk = (surface_form: string, pos = "名詞"): KuromojiToken => ({
      surface_form,
      pos,
      pos_detail_1: "*",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "*",
      conjugated_form: "*",
      basic_form: surface_form,
    });
    if (text === "私は学生です。") {
      return [mk("私"), mk("は", "助詞"), mk("学生"), mk("です", "助動詞"), mk("。", "記号")];
    }
    return [];
  }),
}));

describe("grammarReviewExercise (remplace le mode reveal)", () => {
  it("reconstruction de phrase quand un exemple est disponible (référentiel)", async () => {
    const g: GrammarItem = {
      id: "n5-wa-topic",
      name: "は (thème)",
      rule: "",
      examples: [],
      tags: [],
      status: "review",
    };
    const ex = await grammarReviewExercise(g, 0);
    expect(ex.mode).toBe("build");
    if (ex.mode === "build") {
      expect(ex.target).toEqual(["私", "は", "学生", "です"]); // ponctuation exclue
    }
  });

  it("jamais de mode reveal", async () => {
    const g: GrammarItem = {
      id: "inconnu-sans-exemple",
      name: "x",
      rule: "règle x",
      examples: [],
      tags: [],
      status: "review",
    };
    const ex = await grammarReviewExercise(g, 0);
    expect(ex.mode).not.toBe("reveal" as never);
    expect(["choice", "build", "type"]).toContain(ex.mode);
  });
});

describe("comprehensionReviewExercise (remplace le mode reveal)", () => {
  it("QCM règles voisines, jamais reveal", () => {
    const c: ComprehensionItem = {
      id: "n5-wa-topic",
      name: "は (thème)",
      rule: "Pose le décor de la phrase.",
      status: "review",
    };
    const ex = comprehensionReviewExercise(c, 0);
    expect(ex.mode).toBe("choice");
    expect(ex.choices).toContain("Pose le décor de la phrase.");
    expect(ex.choices[ex.answerIndex]).toBe("Pose le décor de la phrase.");
  });
});
