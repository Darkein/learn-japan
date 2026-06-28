import { describe, expect, it } from "vitest";
import { isCorrectOrder, shuffleTiles, toTiles } from "./builder";
import type { KuromojiToken } from "./tokenizer";

function tok(surface_form: string, pos: string): KuromojiToken {
  return {
    surface_form,
    pos,
    pos_detail_1: "",
    pos_detail_2: "",
    pos_detail_3: "",
    conjugated_type: "",
    conjugated_form: "",
    basic_form: surface_form,
  };
}

describe("toTiles", () => {
  it("garde les mots dans l'ordre et exclut la ponctuation", () => {
    const tokens = [tok("猫", "名詞"), tok("は", "助詞"), tok("水", "名詞"), tok("。", "記号")];
    expect(toTiles(tokens)).toEqual(["猫", "は", "水"]);
  });
});

describe("isCorrectOrder", () => {
  const target = ["猫", "は", "水", "を", "飲む"];

  it("vrai sur le bon ordre, faux sinon", () => {
    expect(isCorrectOrder(["猫", "は", "水", "を", "飲む"], target)).toBe(true);
    expect(isCorrectOrder(["は", "猫", "水", "を", "飲む"], target)).toBe(false);
    expect(isCorrectOrder(["猫", "は", "水", "を"], target)).toBe(false);
  });

  it("tolère les surfaces dupliquées (comparaison positionnelle)", () => {
    const dup = ["私", "は", "猫", "は", "好き"];
    expect(isCorrectOrder(["私", "は", "猫", "は", "好き"], dup)).toBe(true);
    expect(isCorrectOrder(["私", "猫", "は", "は", "好き"], dup)).toBe(false);
  });
});

describe("shuffleTiles", () => {
  it("conserve l'ensemble des tuiles avec des clés uniques", () => {
    const tiles = ["猫", "は", "水", "を", "飲む"];
    const shuffled = shuffleTiles(tiles);
    expect(shuffled.map((t) => t.tile).sort()).toEqual([...tiles].sort());
    expect(new Set(shuffled.map((t) => t.key)).size).toBe(tiles.length);
  });
});
