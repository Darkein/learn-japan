import { describe, expect, it } from "vitest";
import { glossString, glossTokens } from "./gloss";
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

const dict = { 暑い: "chaud", 猫: "chat", 水: "eau", 飲む: "boire" };

describe("gloss littéral", () => {
  it("glose 暑いですね → être-chaud · c'est(poli) · [accord]", () => {
    const tokens = [
      tok({ surface_form: "暑い", pos: "形容詞", pos_detail_1: "自立", basic_form: "暑い" }),
      tok({ surface_form: "です", pos: "助動詞", basic_form: "です" }),
      tok({ surface_form: "ね", pos: "助詞", pos_detail_1: "終助詞", basic_form: "ね" }),
    ];
    expect(glossString(glossTokens(tokens, dict))).toBe(
      "être-chaud · c'est(poli) · [accord]",
    );
  });

  it("marque les morphèmes grammaticaux", () => {
    const tokens = [
      tok({ surface_form: "猫", pos: "名詞", basic_form: "猫" }),
      tok({ surface_form: "が", pos: "助詞", pos_detail_1: "格助詞", basic_form: "が" }),
    ];
    const segs = glossTokens(tokens, dict);
    expect(segs[0]).toMatchObject({ gloss: "chat", grammatical: false });
    expect(segs[1]).toMatchObject({ gloss: "[sujet]", grammatical: true });
  });

  it("glose と selon son emploi : citation, avec, et, condition", () => {
    const to = (d1: string, d2 = "*") => tok({ surface_form: "と", pos: "助詞", pos_detail_1: d1, pos_detail_2: d2 });
    expect(glossTokens([to("格助詞", "引用")], dict)[0].gloss).toBe("[citation]");
    expect(glossTokens([to("格助詞", "一般")], dict)[0].gloss).toBe("avec");
    expect(glossTokens([to("並立助詞")], dict)[0].gloss).toBe("et");
    expect(glossTokens([to("接続助詞")], dict)[0].gloss).toBe("si/quand");
  });
});
