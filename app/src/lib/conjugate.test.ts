import { describe, expect, it } from "vitest";
import { classOf, conjugations } from "./conjugate";

describe("conjugations — formes courantes d'un mot de fiche", () => {
  it("ichidan : たべる", () => {
    const f = conjugations("たべる", { kind: "ichidan" });
    for (const x of ["たべます", "たべません", "たべました", "たべて", "たべた", "たべない", "たべたい", "たべれば", "たべよう"])
      expect(f).toContain(x);
  });

  it("garde la graphie kanji : 食べる → 食べます", () => {
    expect(conjugations("食べる", { kind: "ichidan" })).toContain("食べます");
  });

  it("godan : て/た selon la rangée", () => {
    expect(conjugations("かく", { kind: "godan" })).toEqual(expect.arrayContaining(["かきます", "かいて", "かかない", "かけば", "かこう"]));
    expect(conjugations("およぐ", { kind: "godan" })).toEqual(expect.arrayContaining(["およいで", "およいだ"]));
    expect(conjugations("はなす", { kind: "godan" })).toEqual(expect.arrayContaining(["はなして", "はなしました"]));
    expect(conjugations("よむ", { kind: "godan" })).toEqual(expect.arrayContaining(["よんで", "よんだ", "よみます"]));
    expect(conjugations("かう", { kind: "godan" })).toEqual(expect.arrayContaining(["かって", "かわない"]));
    expect(conjugations("まつ", { kind: "godan" })).toEqual(expect.arrayContaining(["まって", "またない"]));
    expect(conjugations("かえる", { kind: "godan" })).toEqual(expect.arrayContaining(["かえって", "かえります"]));
  });

  it("行く : いって, pas いいて", () => {
    const f = conjugations("いく", { kind: "godan", iku: true });
    expect(f).toContain("いって");
    expect(f).toContain("いきました");
    expect(f).not.toContain("いいて");
  });

  it("する et ses composés, 来る", () => {
    expect(conjugations("べんきょうする", { kind: "suru" })).toEqual(expect.arrayContaining(["べんきょうします", "べんきょうして", "べんきょうしない"]));
    expect(conjugations("くる", { kind: "kuru" })).toEqual(expect.arrayContaining(["きます", "こない", "きて"]));
    expect(conjugations("来る", { kind: "kuru" })).toContain("来ます");
  });

  it("adjectif en い, いい → よ", () => {
    expect(conjugations("たかい", { kind: "adj-i" })).toEqual(expect.arrayContaining(["たかくない", "たかかった", "たかくて"]));
    expect(conjugations("いい", { kind: "adj-i" })).toEqual(expect.arrayContaining(["よくない", "よかった"]));
  });

  it("vide quand la terminaison ne colle pas", () => {
    expect(conjugations("ねこ", { kind: "ichidan" })).toEqual([]);
    expect(conjugations("ねこ", { kind: "adj-i" })).toEqual([]);
  });
});

describe("classOf — classe d'après kuromoji", () => {
  const t = (pos: string, conjugated_type: string) => ({ pos, conjugated_type, basic_form: "" });
  it("lit les étiquettes IPADIC", () => {
    expect(classOf(t("動詞", "一段"))).toEqual({ kind: "ichidan" });
    expect(classOf(t("動詞", "五段・カ行促音便"))).toEqual({ kind: "godan", iku: true });
    expect(classOf(t("動詞", "五段・マ行"))).toEqual({ kind: "godan", iku: false });
    expect(classOf(t("動詞", "サ変・スル"))).toEqual({ kind: "suru" });
    expect(classOf(t("動詞", "カ変・来ル"))).toEqual({ kind: "kuru" });
    expect(classOf(t("形容詞", "形容詞・アウオ段"))).toEqual({ kind: "adj-i" });
    expect(classOf(t("名詞", "*"))).toBeNull();
  });
});
