import { describe, expect, it } from "vitest";
import type { KuromojiToken } from "./tokenizer";
import { spliceAll, spliceAt, unfusedIndexes, wholeWordIndex, wholeWordIndexes } from "./wordSpan";

/** Token minimal : seule la surface compte pour les frontières. */
function tk(...surfaces: string[]): KuromojiToken[] {
  return surfaces.map((surface_form) => ({
    surface_form,
    pos: "名詞",
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: surface_form,
  }));
}

describe("wholeWordIndexes", () => {
  it("trouve le mot posé sur des frontières de tokens", () => {
    const tokens = tk("猫", "が", "走る", "。");
    expect(wholeWordIndexes("猫が走る。", tokens, "猫")).toEqual([0]);
    expect(wholeWordIndexes("猫が走る。", tokens, "走る")).toEqual([2]);
  });

  it("REFUSE une graphie prise au milieu d'un mot plus long", () => {
    // Le bug d'origine : 日本 se lit dans 日本語, mais 「今日、私は◯◯語を勉強します。」
    // demande 日本語（にほんご）, pas la carte 日本（にっぽん）.
    const ja = "今日、私は日本語を勉強します。";
    const tokens = tk("今日", "、", "私", "は", "日本語", "を", "勉強", "し", "ます", "。");
    expect(ja.includes("日本")).toBe(true);
    expect(wholeWordIndexes(ja, tokens, "日本")).toEqual([]);
    expect(wholeWordIndexes(ja, tokens, "日本語")).toEqual([5]);
  });

  it("saute l'occurrence soudée et garde la suivante, isolée", () => {
    // 女 dans 彼女 n'est pas un mot ; celui de la fin en est un.
    const tokens = tk("彼女", "は", "女", "です", "。");
    expect(wholeWordIndexes("彼女は女です。", tokens, "女")).toEqual([3]);
  });

  it("accepte une forme qui couvre PLUSIEURS tokens entiers", () => {
    const tokens = tk("毎日", "勉強", "する", "。");
    expect(wholeWordIndex("毎日勉強する。", tokens, "勉強する")).toBe(2);
  });

  it("okurigana et compteurs : le kanji seul n'est pas le mot", () => {
    expect(wholeWordIndexes("青い空です。", tk("青い", "空", "です", "。"), "青")).toEqual([]);
    expect(wholeWordIndexes("八つある。", tk("八つ", "ある", "。"), "八")).toEqual([]);
  });

  it("ne conclut rien si les tokens ne recollent pas la phrase", () => {
    // Texte retouché après tokenisation : aucune frontière fiable, donc aucun trou.
    expect(wholeWordIndexes("猫が走る。", tk("犬", "が", "走る", "。"), "走る")).toEqual([]);
    expect(wholeWordIndex("猫が走る。", [], "猫")).toBe(-1);
  });

  it("forme vide : aucune occurrence", () => {
    expect(wholeWordIndexes("猫が走る。", tk("猫", "が", "走る", "。"), "")).toEqual([]);
  });
});

describe("unfusedIndexes (repli sans tokenizer)", () => {
  it("garde l'occurrence bordée de kana ou de ponctuation", () => {
    expect(unfusedIndexes("猫が走る。", "猫")).toEqual([0]);
    expect(unfusedIndexes("私は猫を見た。", "猫")).toEqual([2]);
  });

  it("écarte l'occurrence soudée à un kanji voisin", () => {
    expect(unfusedIndexes("今日、私は日本語を勉強します。", "日本")).toEqual([]);
    expect(unfusedIndexes("彼女は女です。", "女")).toEqual([3]);
  });

  it("laisse passer l'okurigana — ce que le tokenizer seul sait trancher", () => {
    // Faux positif assumé : le repli ne sert qu'à la synthèse vocale, où substituer
    // あお dans 青い reste prononçable. Le cloze, lui, exige `wholeWordIndexes`.
    expect(unfusedIndexes("青い空です。", "青")).toEqual([0]);
  });
});

describe("spliceAt / spliceAll", () => {
  it("remplace la tranche demandée, le reste intact", () => {
    expect(spliceAt("彼女は女です。", 3, 1, "◯◯")).toBe("彼女は◯◯です。");
  });

  it("remplace plusieurs positions sans décaler les suivantes", () => {
    expect(spliceAll("日と日", [0, 2], 1, "ひ")).toBe("ひとひ");
  });
});
