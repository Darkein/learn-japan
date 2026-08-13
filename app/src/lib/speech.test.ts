import { describe, expect, it } from "vitest";
import { kanjiSpeechText, wordSpeechText } from "./speech";

describe("wordSpeechText", () => {
  it("prononce la lecture, pas la graphie", () => {
    // Le cas qui motive ce module : 宝 donné tel quel sort « takaramono ».
    expect(wordSpeechText("宝", "たから")).toBe("たから");
    expect(wordSpeechText("宝石", "ほうせき")).toBe("ほうせき");
    expect(wordSpeechText("日本語", "にほんご")).toBe("にほんご");
  });

  it("retire les conventions d'affichage du dico", () => {
    expect(wordSpeechText("～円", "～えん")).toBe("えん");
    expect(wordSpeechText("勉強 (する)", "べんきょう (する)")).toBe("べんきょう");
    expect(wordSpeechText("十", "(〜を) とお")).toBe("とお");
    expect(wordSpeechText("いい; よい", "いい; よい")).toBe("いい");
    expect(wordSpeechText("回る、回す", "まわる、まわす")).toBe("まわる");
  });

  it("garde le katakana tel quel (prononcé correctement)", () => {
    expect(wordSpeechText("テレビ", "テレビ")).toBe("テレビ");
  });

  it("retombe sur la graphie sans lecture exploitable", () => {
    expect(wordSpeechText("ねこ")).toBe("ねこ");
    expect(wordSpeechText("猫", "")).toBe("猫");
    // Entrée du référentiel où lecture et graphie sont inversées.
    expect(wordSpeechText("いただく", "頂く")).toBe("いただく");
  });

  it("nettoie aussi le libellé quand il n'y a que lui (grammaire)", () => {
    expect(wordSpeechText("は (thème)")).toBe("は");
    expect(wordSpeechText("まで (jusqu'à)")).toBe("まで");
  });
});

describe("kanjiSpeechText", () => {
  it("préfère le kun nu", () => {
    expect(kanjiSpeechText(["たから"], ["ほう"])).toBe("たから");
    expect(kanjiSpeechText(["ひ", "-び", "-か"], ["にち", "じつ"])).toBe("ひ");
    expect(kanjiSpeechText(["たか.い", "たか", "-だか"], ["こう"])).toBe("たか");
  });

  it("passe au on quand tous les kun demandent des okurigana ou sont affixaux", () => {
    expect(kanjiSpeechText(["あたら.しい", "あら.た", "あら-", "にい-"], ["しん"])).toBe("しん");
    expect(kanjiSpeechText(["おお-", "おお.きい", "-おお.いに"], ["だい", "たい"])).toBe("だい");
  });

  it("retombe sur un kun avec okurigana, point retiré", () => {
    expect(kanjiSpeechText(["く.う", "た.べる"], [])).toBe("くう");
  });

  it("rend une chaîne vide sans aucune lecture", () => {
    expect(kanjiSpeechText([], [])).toBe("");
  });
});
