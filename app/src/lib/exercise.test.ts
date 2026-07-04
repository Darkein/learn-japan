import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { getComprehensionItem, getGrammar, getVocab, putVocab, _resetDbForTests } from "./db";
import { clozeSentence, gradeExercise, type BuildExercise, type ChoiceExercise, type TypeExercise } from "./exercise";
import { newCard } from "./srs";
import type { KuromojiToken } from "./tokenizer";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

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

describe("clozeSentence", () => {
  it("tronque un article entier à la phrase contenant le trou", () => {
    const cloze = { before: "猫がいます。犬", after: "水を飲みます。鳥もいます。" };
    expect(clozeSentence(cloze, "は")).toBe("犬は水を飲みます。");
  });

  it("trou dans la première phrase (before sans borne)", () => {
    const cloze = { before: "犬", after: "水を飲みます。鳥もいます。" };
    expect(clozeSentence(cloze, "は")).toBe("犬は水を飲みます。");
  });

  it("trou dans la dernière phrase (after sans borne)", () => {
    const cloze = { before: "猫がいます。犬", after: "水を飲みます" };
    expect(clozeSentence(cloze, "は")).toBe("犬は水を飲みます");
  });

  it("before finissant exactement par une borne de phrase", () => {
    const cloze = { before: "猫がいます。", after: "元気です。" };
    expect(clozeSentence(cloze, "とても")).toBe("とても元気です。");
  });

  it("coupe aussi sur les sauts de ligne (borne exclue côté after)", () => {
    const cloze = { before: "一行目\n犬", after: "水を飲みます\n二行目" };
    expect(clozeSentence(cloze, "は")).toBe("犬は水を飲みます");
  });

  it("texte sans ponctuation : renvoie le tout avec la réponse insérée", () => {
    const cloze = { before: "犬", after: "好きです" };
    expect(clozeSentence(cloze, "が")).toBe("犬が好きです");
  });

  it("gère les ponctuations ！ et ？", () => {
    const cloze = { before: "すごい！犬", after: "来ますか？そうです。" };
    expect(clozeSentence(cloze, "が")).toBe("犬が来ますか？");
  });
});

describe("gradeExercise", () => {
  it("type/vocab : note la carte écrite existante", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    const ex: TypeExercise = {
      mode: "type",
      key: "vocab:猫|ねこ",
      track: "vocab",
      id: "猫|ねこ",
      front: "chat",
      back: "猫（ねこ）",
      answers: ["猫", "ねこ"],
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("猫|ねこ");
    expect(v?.status).toBe("review");
    expect(v?.cards.written?.reps).toBe(1);
  });

  it("choice/grammar : crée l'item s'il n'existe pas (particule), avec seedName/seedRule", async () => {
    const ex: ChoiceExercise = {
      mode: "choice",
      key: "particle:0",
      track: "grammar",
      id: "particle:が",
      front: "が",
      back: "が",
      seedName: "particule が",
      seedRule: "[sujet]",
      choices: ["が", "は", "を", "に"],
      answerIndex: 0,
    };
    await gradeExercise(ex, "good", new Date());
    const g = await getGrammar("particle:が");
    expect(g?.name).toBe("particule が");
    expect(g?.rule).toBe("[sujet]");
    expect(g?.card?.reps).toBe(1);
  });

  it("choice/comprehension : crée l'item s'il n'existe pas, note again si incorrect", async () => {
    const ex: ChoiceExercise = {
      mode: "choice",
      key: "comprehension:てもいい",
      track: "comprehension",
      id: "てもいい",
      front: "Que signifie « てもいい » ?",
      back: "permission",
      seedName: "てもいい",
      seedRule: "permission",
      choices: ["permission", "obligation", "interdiction"],
      answerIndex: 0,
    };
    await gradeExercise(ex, "again", new Date());
    const c = await getComprehensionItem("てもいい");
    expect(c?.status).toBe("review");
    expect(c?.card?.reps).toBe(1);
  });

  it("build/vocab : note le vocabulaire de contenu de la phrase, pas la piste grammaire", async () => {
    const tokens = [
      tok({ surface_form: "猫", pos: "名詞", reading: "ネコ", basic_form: "猫" }),
      tok({ surface_form: "が", pos: "助詞" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "build:0",
      track: "vocab",
      id: "build:0",
      front: "Le chat",
      back: "猫 が",
      target: ["猫", "が"],
      tokens,
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("猫|ねこ");
    expect(v?.status).toBe("review");
    const g = await getGrammar("build:0");
    expect(g).toBeUndefined();
  });

  it("build/vocab avec skill oral (dictée) : note cards.oral, pas les mots de la phrase", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { oral: newCard(new Date("2020-01-01")) },
    });
    const tokens = [
      tok({ surface_form: "水", pos: "名詞", reading: "ミズ", basic_form: "水" }),
      tok({ surface_form: "を", pos: "助詞" }),
      tok({ surface_form: "飲む", pos: "動詞", reading: "ノム", basic_form: "飲む" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "vocab-dictation:水|みず",
      track: "vocab",
      skill: "oral",
      id: "水|みず",
      front: "Reconstitue la phrase entendue",
      back: "水 を 飲む",
      target: ["水", "を", "飲む"],
      tokens,
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("水|みず");
    expect(v?.cards.oral?.reps).toBe(1);
    // Le token 飲む n'a PAS été noté individuellement (pas de per-token applyStatus).
    expect(await getVocab("飲む|のむ")).toBeUndefined();
  });

  it("build/grammar : note la carte grammaire, pas le vocabulaire des tokens", async () => {
    const ex: BuildExercise = {
      mode: "build",
      key: "grammar:てもいい",
      track: "grammar",
      id: "てもいい",
      front: "てもいい",
      back: "permission",
      seedName: "てもいい",
      seedRule: "permission",
      target: ["猫", "は", "寝", "てもいい"],
      tokens: [],
    };
    await gradeExercise(ex, "good", new Date());
    const g = await getGrammar("てもいい");
    expect(g?.card?.reps).toBe(1);
    const v = await getVocab("猫|ねこ");
    expect(v).toBeUndefined();
  });
});
