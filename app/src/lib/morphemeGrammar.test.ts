import { beforeAll, describe, expect, it } from "vitest";
import kuromoji from "@sglkc/kuromoji";
import { glossTokens } from "./gloss";
import { grammarPointsAt } from "./morphemeGrammar";
import type { KuromojiToken } from "./tokenizer";

// Le vrai kuromoji : ce que la fiche départage dépend de son découpage et de ses étiquettes.
const DICT = new URL("../../../node_modules/@sglkc/kuromoji/dict/", import.meta.url).pathname;
let tokenizer: { tokenize(text: string): KuromojiToken[] };

beforeAll(async () => {
  tokenizer = await new Promise((ok, ko) =>
    kuromoji.builder({ dicPath: DICT }).build((e: Error | null, t: typeof tokenizer) => (e ? ko(e) : ok(t))),
  );
}, 60_000);

/** Les points du mot `word` (sa n-ième occurrence) dans `sentence`. */
function at(sentence: string, word: string, nth = 0): string[] {
  const tokens = tokenizer.tokenize(sentence);
  const hits = tokens.flatMap((t, i) => (t.surface_form === word ? [i] : []));
  if (hits[nth] === undefined) throw new Error(`${word} absent de ${sentence}`);
  return grammarPointsAt(tokens, hits[nth]).map((p) => p.id);
}

describe("grammarPointsAt — le point de grammaire d'un mot dans sa phrase", () => {
  it("nomme le point et la leçon qui l'introduit", () => {
    const tokens = tokenizer.tokenize("今日は本を読む。");
    const [p] = grammarPointsAt(tokens, 1);
    expect(p.id).toBe("n5-wa-topic");
    expect(p.lesson?.introduces.grammar).toContain("n5-wa-topic");
  });

  it("rend tous les emplois d'une forme que le texte ne départage pas", () => {
    expect(at("学校に行く。", "に").sort()).toEqual(["n5-ni-direction", "n5-ni-location", "n5-ni-time"]);
  });

  it("reconnaît une forme en plusieurs tokens comme un tout", () => {
    expect(at("読みませんでした。", "ん")).toEqual(["n5-masen-deshita"]);
    expect(at("読みました。", "た")).toEqual(["n5-mashita-past"]);
    expect(at("ここで写真をとってもいいですか。", "も")).toEqual(["n4-temo-ii"]);
    expect(at("ここでたばこを吸ってはいけません。", "は")).toEqual(["n4-te-wa-ikenai"]);
    expect(at("日本に行ったことがあります。", "こと")).toEqual(["n4-ta-koto-ga-aru"]);
    expect(at("天気が寒くなりました。", "なり")).toEqual(["n4-ku-ni-naru"]);
    expect(at("今から出かけるところです。", "ところ")).toEqual(["n3-tokoro-mae"]);
  });

  it("exige toutes les pièces d'une forme à trou", () => {
    expect(at("水しか飲まない。", "ない")).toEqual(["n4-shika-nai"]);
    expect(at("水を飲まない。", "ない")).toEqual(["n5-nai-negative"]);
  });

  it("と : citation, « et », « avec » ou condition, d'après la phrase", () => {
    expect(at("「はい」とタロウは答えた。", "と")).toEqual(["n5-to-quote"]);
    expect(at("猫は水を飲むと言いました。", "と")).toEqual(["n5-to-quote"]);
    expect(at("私とあなたは学生です。", "と")).toEqual(["n5-to-and"]);
    expect(at("私は犬と歩く。", "と")).toEqual(["n5-to-with"]);
    expect(at("母と日本へ行く。", "と")).toEqual(["n5-to-with"]);
    expect(at("春になると暖かい。", "と")).toEqual(["n4-to-conditional"]);
    // Une forme plus longue garde la main.
    expect(at("天気予報によると、明日は雨だそうです。", "と")).toEqual(["n3-ni-yoruto"]);
  });

  it("départage par ce qui entoure le mot", () => {
    expect(at("雨が降るから、行かない。", "から")).toEqual(["n4-kara-cause"]);
    expect(at("駅から歩く。", "から")).toEqual(["n5-kara-from"]);
    expect(at("本を読んでいる。", "いる")).toEqual(["n5-teiru-progressive"]);
    expect(at("猫がいる。", "いる")).toEqual(["n5-iru"]);
    expect(at("本を読んだ。", "だ")).toEqual(["n5-ta-past"]);
    expect(at("学生だ。", "だ")).toEqual(["n5-da-copula"]);
    expect(at("雨が降りそうだ。", "そう")).toEqual(["n4-sou-appearance"]);
    expect(at("雨が降るそうだ。", "そう")).toEqual(["n4-sou-hearsay"]);
    expect(at("見よう。", "う")).toEqual(["n4-volitional"]);
    expect(at("雨のようです。", "よう")).toEqual(["n4-youda"]);
    expect(at("雨が降ったら、行かない。", "たら")).toEqual(["n4-tara-conditional"]);
  });

  it("reconnaît les points sans forme écrite", () => {
    expect(at("静かな海。", "な")).toEqual(["n5-naadj"]);
    expect(at("暑い日。", "暑い")).toEqual(["n5-iadj-attributive"]);
    expect(at("今日は暑い。", "暑い")).toEqual(["n5-iadj-predicate"]);
    expect(at("暑くない。", "ない")).toEqual(["n5-iadj-negative"]);
    expect(at("勉強する。", "勉強")).toEqual(["n5-suru-verb"]);
    expect(at("早く起きろ。", "起きろ")).toEqual(["n4-imperative"]);
    expect(at("何を買うか、まだ決めていません。", "か")).toEqual(["n4-question-embed"]);
  });

  it("ne prend pas un mot voisin pour une forme : でも, なん, かな, 誰か", () => {
    expect(at("お茶でも飲みませんか。", "も")).toEqual(["n5-mo-also"]);
    expect(at("猫は魚が大好きなんです。", "な")).toEqual(["n5-naadj"]);
    expect(at("明日は晴れるかな。", "な")).toEqual([]);
    expect(at("行くな。", "な")).toEqual(["n4-prohibitive"]);
    expect(at("誰かが窓をたたいています。", "か")).toEqual([]);
    expect(at("この店は安くて、おいしいです。", "安く")).toEqual([]);
  });

  it("répare les interrogatifs en kana que kuromoji découpe mal", () => {
    expect(at("あの人はだれですか。", "だれ")).toEqual(["n5-dare-who"]);
  });

  it("ne rend rien pour un morphème hors programme", () => {
    expect(at("行くぞ。", "ぞ")).toEqual([]);
  });
});

describe("gloss de と dans sa phrase", () => {
  const glossOf = (sentence: string) =>
    glossTokens(tokenizer.tokenize(sentence), {}).find((g) => g.surface === "と")?.gloss;

  it("citation, et, avec, condition", () => {
    expect(glossOf("「はい」とタロウは答えた。")).toBe("[citation]");
    expect(glossOf("私とあなたは学生です。")).toBe("et");
    expect(glossOf("私は犬と歩く。")).toBe("avec");
    expect(glossOf("春になると暖かい。")).toBe("si/quand");
  });
});
