import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetDbForTests,
  allReviews,
  getGrammar,
  getVocab,
  logReview,
  putGrammar,
  putVocab,
  type GrammarItem,
  type VocabItem,
} from "./db";
import { SRS } from "./config";
import { newCard, review } from "./srs";
import { loadLeechIds, resetItemProgress } from "./leech";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

const NOW = new Date("2026-07-04T12:00:00");

function vocabItem(id: string): VocabItem {
  return {
    id,
    surface: "暗記",
    reading: "あんき",
    meaning: "mémorisation",
    tags: [],
    status: "known",
    cards: { written: review(newCard(NOW), "again", NOW) },
    streak: 3,
    lastDir: "kanji>kana",
  };
}

function grammarItem(id: string): GrammarItem {
  return { id, name: "は", rule: "thème", examples: [], tags: [], status: "known", card: newCard(NOW) };
}

/** Journalise assez d'échecs pour franchir le seuil d'élément difficile. */
async function logLapses(itemId: string, track: "vocab" | "grammar") {
  for (let i = 0; i < SRS.leechLapses; i++) {
    await logReview({ itemId, track, grade: "again", at: NOW.getTime() + i });
  }
}

describe("resetItemProgress", () => {
  it("sort le mot des éléments difficiles et le renvoie en apprentissage", async () => {
    await putVocab(vocabItem("暗記|あんき"));
    await logLapses("暗記|あんき", "vocab");
    expect(await loadLeechIds()).toContain("暗記|あんき");

    await resetItemProgress("vocab", "暗記|あんき", new Date(NOW.getTime() + 1000));

    // Le bouton « Réinitialiser » doit avoir un effet VISIBLE : plus de badge difficile.
    expect(await loadLeechIds()).not.toContain("暗記|あんき");
    const v = (await getVocab("暗記|あんき"))!;
    expect(v.status).toBe("review");
    expect(v.streak).toBe(0);
    expect(v.lastDir).toBeUndefined();
    expect(v.cards.written!.reps).toBe(0);
  });

  it("journalise le jalon sans effacer le log (append-only)", async () => {
    await putVocab(vocabItem("暗記|あんき"));
    await logLapses("暗記|あんき", "vocab");
    await resetItemProgress("vocab", "暗記|あんき", NOW);
    const reviews = await allReviews();
    expect(reviews).toHaveLength(SRS.leechLapses + 1);
    expect(reviews.filter((r) => r.grade === "again")).toHaveLength(SRS.leechLapses);
  });

  it("remet aussi un point de grammaire à zéro", async () => {
    await putGrammar(grammarItem("wa"));
    await logLapses("wa", "grammar");
    await resetItemProgress("grammar", "wa", NOW);
    expect(await loadLeechIds()).not.toContain("wa");
    expect((await getGrammar("wa"))!.status).toBe("review");
  });

  it("ignore un élément absent de la base (rien à remettre à zéro)", async () => {
    await resetItemProgress("vocab", "fantôme", NOW);
    expect(await allReviews()).toHaveLength(0);
  });
});
