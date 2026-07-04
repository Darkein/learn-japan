import { describe, expect, it } from "vitest";
import { isAcceptableOrder, toChunks } from "./buildOrders";
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

// 私は今日学校に行きます。
const WATASHI_KYOU = [
  tok({ surface_form: "私", pos: "名詞" }),
  tok({ surface_form: "は", pos: "助詞", pos_detail_1: "係助詞" }),
  tok({ surface_form: "今日", pos: "名詞", pos_detail_1: "副詞可能" }),
  tok({ surface_form: "学校", pos: "名詞" }),
  tok({ surface_form: "に", pos: "助詞", pos_detail_1: "格助詞" }),
  tok({ surface_form: "行き", pos: "動詞" }),
  tok({ surface_form: "ます", pos: "助動詞" }),
  tok({ surface_form: "。", pos: "記号" }),
];

// 私の本は高いです。
const WATASHI_HON = [
  tok({ surface_form: "私", pos: "名詞" }),
  tok({ surface_form: "の", pos: "助詞", pos_detail_1: "連体化" }),
  tok({ surface_form: "本", pos: "名詞" }),
  tok({ surface_form: "は", pos: "助詞", pos_detail_1: "係助詞" }),
  tok({ surface_form: "高い", pos: "形容詞" }),
  tok({ surface_form: "です", pos: "助動詞" }),
  tok({ surface_form: "。", pos: "記号" }),
];

// 私は食べて、学校に行く。 (て = jointure de propositions → barrière)
const TWO_CLAUSES = [
  tok({ surface_form: "私", pos: "名詞" }),
  tok({ surface_form: "は", pos: "助詞", pos_detail_1: "係助詞" }),
  tok({ surface_form: "食べ", pos: "動詞" }),
  tok({ surface_form: "て", pos: "助詞", pos_detail_1: "接続助詞" }),
  tok({ surface_form: "、", pos: "記号" }),
  tok({ surface_form: "学校", pos: "名詞" }),
  tok({ surface_form: "に", pos: "助詞", pos_detail_1: "格助詞" }),
  tok({ surface_form: "行く", pos: "動詞" }),
  tok({ surface_form: "。", pos: "記号" }),
];

describe("toChunks", () => {
  it("découpe en bunsetsu avec particules rattachées, prédicat final non movable", () => {
    const chunks = toChunks(WATASHI_KYOU);
    expect(chunks.map((c) => c.tiles)).toEqual([["私", "は"], ["今日"], ["学校", "に"], ["行き", "ます"]]);
    expect(chunks.map((c) => c.movable)).toEqual([true, true, true, false]);
  });

  it("fusionne un syntagme en の avec son nom", () => {
    const chunks = toChunks(WATASHI_HON);
    expect(chunks.map((c) => c.tiles)).toEqual([["私", "の", "本", "は"], ["高い", "です"]]);
    expect(chunks.map((c) => c.movable)).toEqual([true, false]);
  });

  it("un chunk contenant un verbe + 接続助詞 n'est pas movable", () => {
    const chunks = toChunks(TWO_CLAUSES);
    expect(chunks.map((c) => c.tiles)).toEqual([["私", "は"], ["食べ", "て"], ["学校", "に"], ["行く"]]);
    expect(chunks.map((c) => c.movable)).toEqual([true, false, true, false]);
  });
});

describe("isAcceptableOrder", () => {
  it("accepte l'ordre canonique", () => {
    expect(isAcceptableOrder(["私", "は", "今日", "学校", "に", "行き", "ます"], WATASHI_KYOU)).toBe(true);
  });

  it("accepte les permutations thème/temps/lieu devant le prédicat", () => {
    expect(isAcceptableOrder(["今日", "私", "は", "学校", "に", "行き", "ます"], WATASHI_KYOU)).toBe(true);
    expect(isAcceptableOrder(["学校", "に", "今日", "私", "は", "行き", "ます"], WATASHI_KYOU)).toBe(true);
  });

  it("rejette un prédicat non final", () => {
    expect(isAcceptableOrder(["行き", "ます", "私", "は", "今日", "学校", "に"], WATASHI_KYOU)).toBe(false);
    expect(isAcceptableOrder(["私", "は", "行き", "ます", "今日", "学校", "に"], WATASHI_KYOU)).toBe(false);
  });

  it("rejette une particule détachée de son nom", () => {
    expect(isAcceptableOrder(["私", "今日", "は", "学校", "に", "行き", "ます"], WATASHI_KYOU)).toBe(false);
  });

  it("rejette la scission d'un syntagme en の", () => {
    expect(isAcceptableOrder(["本", "は", "私", "の", "高い", "です"], WATASHI_HON)).toBe(false);
  });

  it("rejette le franchissement d'une frontière de proposition", () => {
    // 学校に ne peut pas passer avant 食べて (barrière non movable).
    expect(isAcceptableOrder(["学校", "に", "私", "は", "食べ", "て", "行く"], TWO_CLAUSES)).toBe(false);
    expect(isAcceptableOrder(["私", "は", "食べ", "て", "学校", "に", "行く"], TWO_CLAUSES)).toBe(true);
  });

  it("rejette une liste de tuiles incomplète", () => {
    expect(isAcceptableOrder(["私", "は"], WATASHI_KYOU)).toBe(false);
  });
});
