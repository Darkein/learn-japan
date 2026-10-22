import { describe, expect, it } from "vitest";
import { grammarPointsFor } from "./morphemeGrammar";
import type { KuromojiToken } from "./tokenizer";

function tok(surface: string, pos: string, detail: string, basic = surface): KuromojiToken {
  return {
    surface_form: surface,
    pos,
    pos_detail_1: detail,
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: basic,
  };
}

const ids = (t: KuromojiToken) => grammarPointsFor(t).map((p) => p.id);

describe("grammarPointsFor — le point de grammaire d'un morphème et sa leçon", () => {
  it("nomme le point et la leçon qui l'introduit", () => {
    const [p] = grammarPointsFor(tok("は", "助詞", "係助詞"));
    expect(p.id).toBe("n5-wa-topic");
    expect(p.lesson?.id).toBeTruthy();
    expect(p.lesson?.introduces.grammar).toContain("n5-wa-topic");
  });

  it("rend tous les emplois d'une forme partagée, dans l'ordre du curriculum", () => {
    expect(ids(tok("に", "助詞", "格助詞")).sort()).toEqual(["n5-ni-direction", "n5-ni-location", "n5-ni-time"]);
  });

  it("départage par la catégorie du token quand elle tranche", () => {
    expect(ids(tok("から", "助詞", "格助詞"))).toEqual(["n5-kara-from"]);
    expect(ids(tok("から", "助詞", "接続助詞"))).toEqual(["n4-kara-cause"]);
    // 読んで : le で de la て-forme, pas celui du lieu ou du moyen.
    expect(ids(tok("で", "助詞", "接続助詞"))).toEqual(["n5-te-form"]);
    // 〜ている : いる non autonome, pas « exister ».
    expect(ids(tok("いる", "動詞", "非自立"))).toEqual(["n5-teiru-progressive"]);
  });

  it("lit la forme de base d'un auxiliaire conjugué", () => {
    expect(ids(tok("でし", "助動詞", "*", "です"))).toContain("n5-desu-copula");
  });

  it("ne rend rien pour un morphème hors programme", () => {
    expect(grammarPointsFor(tok("ぞ", "助詞", "終助詞"))).toEqual([]);
  });
});
