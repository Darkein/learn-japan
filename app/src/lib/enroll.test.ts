import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrammar, getVocab, putVocab, _resetDbForTests } from "./db";
import { newCard } from "./srs";
import type { KuromojiToken } from "./tokenizer";

// Simule le tokenizer (kuromoji ne tourne pas en node)
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> => {
    // Retourne des tokens fictifs selon le texte passé dans les tests
    if (text.includes("猫")) {
      return [
        {
          surface_form: "猫",
          pos: "名詞",
          pos_detail_1: "一般",
          pos_detail_2: "*",
          pos_detail_3: "*",
          conjugated_type: "*",
          conjugated_form: "*",
          basic_form: "猫",
          reading: "ネコ",
        },
        {
          surface_form: "は",
          pos: "助詞",
          pos_detail_1: "*",
          pos_detail_2: "*",
          pos_detail_3: "*",
          conjugated_type: "*",
          conjugated_form: "*",
          basic_form: "は",
        },
        {
          surface_form: "走る",
          pos: "動詞",
          pos_detail_1: "自立",
          pos_detail_2: "*",
          pos_detail_3: "*",
          conjugated_type: "*",
          conjugated_form: "*",
          basic_form: "走る",
          reading: "ハシル",
        },
      ];
    }
    return [];
  }),
}));

vi.mock("./inventory", () => ({
  resolveVocab: vi.fn((id: string) => {
    const [surface] = id.split("|");
    return { ja: surface, fr: `sens-${surface}` };
  }),
  grammarDetail: vi.fn((id: string) => ({
    id,
    name: `gramm-${id}`,
    ruleFr: `règle-${id}`,
    exampleJa: `例-${id}`,
  })),
}));

// Simule getCurriculumEntry pour enrollLesson
vi.mock("./curriculum", () => ({
  getCurriculumEntry: vi.fn((id: string) => {
    if (id === "lesson-test") {
      return {
        id: "lesson-test",
        introduces: {
          vocab: ["水|みず"],
          grammar: ["n5-wa"],
        },
      };
    }
    return undefined;
  }),
}));

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

import { enrollLesson, enrollStory } from "./enroll";
import type { StoryRecord } from "./db";

function makeStory(text: string): StoryRecord {
  return {
    id: "story-1",
    createdAt: Date.now(),
    title: "Test",
    text,
    params: {},
  };
}

describe("enrollLesson", () => {
  it("crée les items vocab/grammaire sans carte FSRS", async () => {
    await enrollLesson("lesson-test");

    const vocab = await getVocab("水|みず");
    expect(vocab).toBeDefined();
    expect(vocab!.cards).toEqual({});
    expect(vocab!.status).toBe("unknown");

    const grammar = await getGrammar("n5-wa");
    expect(grammar).toBeDefined();
    expect(grammar!.card).toBeUndefined();
  });

  it("est idempotent — appeler deux fois ne duplique pas", async () => {
    await enrollLesson("lesson-test");
    await enrollLesson("lesson-test");

    // Si la base était corrompue on aurait une erreur de clé dupliquée ou une valeur altérée
    const vocab = await getVocab("水|みず");
    expect(vocab).toBeDefined();
  });

  it("ne remplace pas un item qui possède déjà une carte FSRS", async () => {
    const card = newCard(new Date("2020-01-01"));
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: card },
    });

    await enrollLesson("lesson-test");

    const vocab = await getVocab("水|みず");
    expect(vocab!.cards.written).toBeDefined();
    expect(vocab!.status).toBe("review");
  });
});

describe("enrollStory", () => {
  it("crée les items vocab depuis les tokens de contenu", async () => {
    const story = makeStory("猫は走る。");
    await enrollStory(story);

    const neko = await getVocab("猫|ねこ");
    expect(neko).toBeDefined();
    expect(neko!.cards).toEqual({});

    const hashiru = await getVocab("走る|はしる");
    expect(hashiru).toBeDefined();
    expect(hashiru!.cards).toEqual({});
  });

  it("capture la phrase d'exemple contenant le token", async () => {
    const story = makeStory("猫は走る。");
    await enrollStory(story);

    const neko = await getVocab("猫|ねこ");
    expect(neko!.example).toBeDefined();
    expect(neko!.example!.ja).toContain("猫");
  });
});
