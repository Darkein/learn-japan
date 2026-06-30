import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { getComprehensionItem, getGrammar, getVocab, putVocab, _resetDbForTests } from "./db";
import { gradeExercise, type BuildExercise, type ChoiceExercise, type TypeExercise } from "./exercise";
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
