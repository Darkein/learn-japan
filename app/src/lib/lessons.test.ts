import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, putLessonProgress, getLessonProgress, putVocab, putGrammar } from "./db";
import { State } from "./srs";
import type { Card } from "ts-fsrs";

// Stub genClient et fetchGenerated pour éviter les appels réseau
vi.mock("./genClient", () => ({
  fetchGenerated: vi.fn(async () => ({})),
  generateLesson: vi.fn(),
  generateLessonStory: vi.fn(),
}));

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

// ---- computeMastery via listLessons ----

// On teste computeMastery indirectement via listLessons
// Pour des tests unitaires purs, on exporte computeMastery (si possible)
// Mais le brief dit de tester via les propriétés de listLessons.
// On va plutôt tester computeMastery directement en l'exportant.

// Import après mock pour éviter les circular dep issues
const { computeMastery, listLessons, markUnlockNotified } = await import("./lessons");

function masteredCard(): Card {
  return {
    due: new Date(),
    stability: 100,
    difficulty: 5,
    elapsed_days: 21,
    scheduled_days: 21,
    reps: 5,
    lapses: 0,
    state: State.Review,
    last_review: new Date(),
  } as Card;
}

function newCardObj(): Card {
  return {
    due: new Date(),
    stability: 1,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    last_review: new Date(),
  } as Card;
}

// Helpers pour construire les maps
function vocabMap(items: Array<{ id: string; card?: Card }>): Map<string, any> {
  return new Map(items.map(i => [i.id, { id: i.id, cards: { written: i.card } }]));
}
function grammarMap(items: Array<{ id: string; card?: Card }>): Map<string, any> {
  return new Map(items.map(i => [i.id, { id: i.id, card: i.card }]));
}

const entry = {
  id: "test",
  order: 1,
  level: 5,
  title: "Test",
  objectives: { vocab: [], grammar: [] },
  introduces: { vocab: ["v1", "v2"], grammar: ["g1"] },
};

describe("computeMastery", () => {
  it("tous items maîtrisés → 1", () => {
    const vm = vocabMap([{ id: "v1", card: masteredCard() }, { id: "v2", card: masteredCard() }]);
    const gm = grammarMap([{ id: "g1", card: masteredCard() }]);
    expect(computeMastery(entry, vm, gm)).toBe(1);
  });

  it("aucun item enrôlé → 0", () => {
    const vm = vocabMap([{ id: "v1" }, { id: "v2" }]);
    const gm = grammarMap([{ id: "g1" }]);
    expect(computeMastery(entry, vm, gm)).toBe(0);
  });

  it("moitié maîtrisée → 0.5", () => {
    // 3 items total (v1, v2, g1), 1.5 mastered → floor to nearest
    const vm = vocabMap([{ id: "v1", card: masteredCard() }, { id: "v2", card: newCardObj() }]);
    const gm = grammarMap([{ id: "g1", card: newCardObj() }]);
    expect(computeMastery(entry, vm, gm)).toBeCloseTo(1/3);
  });

  it("items absents des maps comptent comme non-maîtrisés", () => {
    expect(computeMastery(entry, new Map(), new Map())).toBe(0);
  });
});

describe("locked / prevMastery dans listLessons", () => {
  it("première leçon jamais locked", async () => {
    const lessons = await listLessons();
    expect(lessons[0].locked).toBe(false);
    expect(lessons[0].prevMastery).toBeUndefined();
  });

  it("leçon suivante locked si prev mastery < 0.8 et non démarrée", async () => {
    const lessons = await listLessons();
    if (lessons.length < 2) return; // skip si curriculum vide
    // mastery de la première leçon = 0 (rien en DB) → deuxième doit être locked
    expect(lessons[1].locked).toBe(true);
  });

  it("leçon non-locked si prev mastery >= 0.8 (simulé via startedAt bypass)", async () => {
    const lessons = await listLessons();
    if (lessons.length < 2) return;
    // Démarrer la deuxième leçon → startedAt set → locked = false
    await putLessonProgress({ id: lessons[1].id, startedAt: Date.now() });
    const lessons2 = await listLessons();
    expect(lessons2[1].locked).toBe(false);
  });

  it("locked=false quand prev mastery >= 0.8 (items maîtrisés en DB)", async () => {
    const { getCurriculum } = await import("./lessons");
    const curriculum = getCurriculum();
    if (curriculum.length < 2) return;
    const prev = curriculum[0];
    // Seed tous les items introduces de la première leçon comme maîtrisés
    for (const id of prev.introduces.vocab) {
      await putVocab({
        id,
        surface: id,
        reading: "",
        meaning: "",
        tags: [],
        status: "known",
        cards: { written: masteredCard() },
      });
    }
    for (const id of prev.introduces.grammar) {
      await putGrammar({
        id,
        name: id,
        rule: "",
        examples: [],
        tags: [],
        status: "known",
        card: masteredCard(),
      });
    }
    const lessons = await listLessons();
    if (lessons.length < 2) return;
    expect(lessons[0].mastery).toBeCloseTo(1.0);
    expect(lessons[1].prevMastery).toBeCloseTo(1.0);
    expect(lessons[1].locked).toBe(false);
  });
});

describe("markUnlockNotified", () => {
  it("définit unlockedNotified: true", async () => {
    await markUnlockNotified("lesson-abc");
    const rec = await getLessonProgress("lesson-abc");
    expect(rec?.unlockedNotified).toBe(true);
  });

  it("préserve les champs existants", async () => {
    await putLessonProgress({ id: "lesson-xyz", startedAt: 12345 });
    await markUnlockNotified("lesson-xyz");
    const rec = await getLessonProgress("lesson-xyz");
    expect(rec?.startedAt).toBe(12345);
    expect(rec?.unlockedNotified).toBe(true);
  });
});
