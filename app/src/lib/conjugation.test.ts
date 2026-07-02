import { describe, expect, it, vi } from "vitest";
import {
  classFromType,
  conjugate,
  conjugationExercise,
  detectVerbClass,
  type ConjForm,
  type JaPair,
  type VerbClass,
} from "./conjugation";
import type { KuromojiToken } from "./tokenizer";

// Simule le tokenizer (kuromoji ne tourne pas en node) — même approche que enroll.test.ts.
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> => {
    const TYPES: Record<string, string> = {
      食べる: "一段",
      作る: "五段・ラ行",
      書く: "五段・カ行イ音便",
      行く: "五段・カ行促音便",
      買う: "五段・ワ行促音便",
      問う: "五段・ワ行ウ音便",
    };
    const type = TYPES[text];
    if (!type) return [];
    return [
      {
        surface_form: text,
        pos: "動詞",
        pos_detail_1: "自立",
        pos_detail_2: "*",
        pos_detail_3: "*",
        conjugated_type: type,
        conjugated_form: "基本形",
        basic_form: text,
      },
    ];
  }),
}));

function conj(surface: string, reading: string, cls: VerbClass, form: ConjForm): string {
  const r = conjugate({ surface, reading }, cls, form);
  return r ? `${r.surface}|${r.reading}` : "∅";
}

describe("conjugate — 一段", () => {
  const v: JaPair = { surface: "食べる", reading: "たべる" };
  it.each([
    ["masu", "食べます|たべます"],
    ["masen", "食べません|たべません"],
    ["mashita", "食べました|たべました"],
    ["masendeshita", "食べませんでした|たべませんでした"],
    ["te", "食べて|たべて"],
    ["tekudasai", "食べてください|たべてください"],
    ["teiru", "食べている|たべている"],
    ["ta", "食べた|たべた"],
    ["nai", "食べない|たべない"],
  ] as [ConjForm, string][])("%s", (form, expected) => {
    expect(conj(v.surface, v.reading, "ichidan", form)).toBe(expected);
  });
});

describe("conjugate — 五段 (euphonies て/た)", () => {
  it.each([
    // [dico, lecture, te attendu, ta attendu]
    ["書く", "かく", "書いて|かいて", "書いた|かいた"],
    ["泳ぐ", "およぐ", "泳いで|およいで", "泳いだ|およいだ"],
    ["話す", "はなす", "話して|はなして", "話した|はなした"],
    ["待つ", "まつ", "待って|まって", "待った|まった"],
    ["死ぬ", "しぬ", "死んで|しんで", "死んだ|しんだ"],
    ["遊ぶ", "あそぶ", "遊んで|あそんで", "遊んだ|あそんだ"],
    ["読む", "よむ", "読んで|よんで", "読んだ|よんだ"],
    ["作る", "つくる", "作って|つくって", "作った|つくった"],
    ["買う", "かう", "買って|かって", "買った|かった"],
    // 行く : 促音便 (行いて serait faux)
    ["行く", "いく", "行って|いって", "行った|いった"],
  ])("%s", (s, r, te, ta) => {
    expect(conj(s, r, "godan", "te")).toBe(te);
    expect(conj(s, r, "godan", "ta")).toBe(ta);
  });

  it("bases ます / ない", () => {
    expect(conj("読む", "よむ", "godan", "masu")).toBe("読みます|よみます");
    expect(conj("買う", "かう", "godan", "nai")).toBe("買わない|かわない");
    expect(conj("行く", "いく", "godan", "masu")).toBe("行きます|いきます");
  });

  it("ある → négation supplétive ない", () => {
    expect(conj("ある", "ある", "godan", "nai")).toBe("ない|ない");
    expect(conj("ある", "ある", "godan", "masu")).toBe("あります|あります");
  });
});

describe("conjugate — irréguliers する / 来る", () => {
  it("する et composés nom+する", () => {
    expect(conj("する", "する", "suru", "masu")).toBe("します|します");
    expect(conj("勉強する", "べんきょうする", "suru", "te")).toBe("勉強して|べんきょうして");
    expect(conj("勉強する", "べんきょうする", "suru", "nai")).toBe("勉強しない|べんきょうしない");
  });

  it("来る : lecture irrégulière き/こ", () => {
    expect(conj("来る", "くる", "kuru", "masu")).toBe("来ます|きます");
    expect(conj("来る", "くる", "kuru", "nai")).toBe("来ない|こない");
    expect(conj("来る", "くる", "kuru", "te")).toBe("来て|きて");
    expect(conj("くる", "くる", "kuru", "masu")).toBe("きます|きます");
    expect(conj("くる", "くる", "kuru", "nai")).toBe("こない|こない");
  });
});

describe("classFromType", () => {
  it("mappe les types IPADIC vers les classes couvertes", () => {
    expect(classFromType("一段")).toBe("ichidan");
    expect(classFromType("五段・ラ行")).toBe("godan");
    expect(classFromType("五段・カ行促音便")).toBe("godan");
    expect(classFromType("カ変・来ル")).toBe("kuru");
    expect(classFromType("サ変・スル")).toBe("suru");
  });

  it("exclut les 五段 irréguliers hors modèle", () => {
    expect(classFromType("五段・ワ行ウ音便")).toBeNull(); // 問う → 問うて
    expect(classFromType("五段・ラ行特殊")).toBeNull(); // 下さる → 下さい
    expect(classFromType("*")).toBeNull();
  });
});

describe("detectVerbClass", () => {
  it("désambiguïse -る via kuromoji : 食べる (一段) vs 作る (五段)", async () => {
    expect(await detectVerbClass({ surface: "食べる", reading: "たべる" })).toBe("ichidan");
    expect(await detectVerbClass({ surface: "作る", reading: "つくる" })).toBe("godan");
  });

  it("composés nom+する sans tokenizer ; non-verbes → null", async () => {
    expect(await detectVerbClass({ surface: "勉強する", reading: "べんきょうする" })).toBe("suru");
    expect(await detectVerbClass({ surface: "こおり", reading: "こおり" })).toBeNull();
  });
});

describe("conjugationExercise", () => {
  it("construit un drill de saisie pour un point de conjugaison dû", async () => {
    const ex = await conjugationExercise(
      { id: "n5-te-form", name: "て-forme", rule: "Forme en て : enchaîne les actions." },
      [{ surface: "食べる", reading: "たべる", meaning: "manger" }],
      42,
    );
    expect(ex).not.toBeNull();
    expect(ex!.mode).toBe("type");
    expect(ex!.track).toBe("grammar");
    expect(ex!.id).toBe("n5-te-form");
    expect(ex!.answers).toEqual(expect.arrayContaining(["食べて", "たべて"]));
    expect(ex!.due).toBe(42);
  });

  it("point de grammaire hors conjugaison → null (repli sur le QCM)", async () => {
    const ex = await conjugationExercise(
      { id: "n5-wa-topic", name: "は", rule: "Thème." },
      [{ surface: "食べる", reading: "たべる", meaning: "manger" }],
      0,
    );
    expect(ex).toBeNull();
  });

  it("aucun verbe conjugable dans le pool → null", async () => {
    const ex = await conjugationExercise(
      { id: "n5-te-form", name: "て-forme", rule: "" },
      [{ surface: "こおり", reading: "こおり", meaning: "glace" }],
      0,
    );
    expect(ex).toBeNull();
  });
});
