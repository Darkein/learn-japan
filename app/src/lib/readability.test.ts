import { describe, expect, it } from "vitest";
import type { ItemStatus } from "./db";
import { computeReadability } from "./readability";
import type { KuromojiToken } from "./tokenizer";

function mk(surface: string, pos = "名詞", reading?: string): KuromojiToken {
  return {
    surface_form: surface,
    pos,
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: surface,
    reading,
  };
}

describe("computeReadability", () => {
  it("compte les occurrences de contenu et la couverture connue", () => {
    // 猫 (connu) apparaît deux fois, 犬 (à revoir) une fois, 魚 (inconnu) une fois.
    const tokens = [
      mk("猫", "名詞", "ネコ"),
      mk("は", "助詞"),
      mk("犬", "名詞", "イヌ"),
      mk("と", "助詞"),
      mk("猫", "名詞", "ネコ"),
      mk("魚", "名詞", "サカナ"),
      mk("。", "記号"),
    ];
    const statuses = new Map<string, ItemStatus>([
      ["猫|ねこ", "known"],
      ["犬|いぬ", "review"],
    ]);
    const r = computeReadability(tokens, statuses);
    expect(r.total).toBe(4);
    expect(r.known).toBe(2);
    expect(r.learning).toBe(1);
    expect(r.coverage).toBeCloseTo(0.5);
  });

  it("texte sans mot de contenu → couverture 1 (rien à connaître)", () => {
    const tokens = [mk("は", "助詞"), mk("。", "記号")];
    const r = computeReadability(tokens, new Map());
    expect(r.total).toBe(0);
    expect(r.coverage).toBe(1);
  });
});
