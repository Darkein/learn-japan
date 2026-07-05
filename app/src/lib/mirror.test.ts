import { describe, expect, it } from "vitest";
import type { ReviewLog, StoryRecord, VocabItem } from "./db";
import { computeMirrorDelta, pickMirrorCandidate } from "./mirror";

const NOW = new Date("2026-07-05T12:00:00");
const DAY = 24 * 3600e3;

function story(id: string, ageDays: number): StoryRecord {
  return {
    id,
    createdAt: NOW.getTime() - ageDays * DAY,
    title: id,
    text: "",
    params: {},
  };
}

function log(itemId: string, at: number): ReviewLog {
  return { itemId, track: "vocab", skill: "written", grade: "good", at };
}

function vocab(id: string, tracked = true): VocabItem {
  return {
    id,
    surface: id.split("|")[0],
    reading: "",
    meaning: "—",
    tags: [],
    status: "known",
    cards: tracked ? { written: {} as never } : {},
  };
}

describe("pickMirrorCandidate", () => {
  it("rien avant 30 jours d'historique", () => {
    expect(pickMirrorCandidate([story("s1", 10), story("s2", 29)], undefined, NOW)).toBeNull();
  });

  it("choisit la plus ancienne histoire éligible", () => {
    const c = pickMirrorCandidate([story("récente", 35), story("ancienne", 90)], undefined, NOW);
    expect(c?.storyId).toBe("ancienne");
    expect(c?.ageDays).toBe(90);
  });

  it("respecte le refroidissement de 14 jours", () => {
    const stories = [story("s1", 60)];
    expect(pickMirrorCandidate(stories, NOW.getTime() - 5 * DAY, NOW)).toBeNull();
    expect(pickMirrorCandidate(stories, NOW.getTime() - 15 * DAY, NOW)?.storyId).toBe("s1");
  });
});

describe("computeMirrorDelta", () => {
  const createdAt = NOW.getTime() - 60 * DAY;

  it("sépare « connu à l'époque » (1ʳᵉ review avant createdAt) et « suivi aujourd'hui »", () => {
    const ids = ["水|", "火|", "山|", "川|"];
    const reviews = [
      log("水|", createdAt - 10 * DAY), // connu avant
      log("水|", createdAt + 10 * DAY),
      log("火|", createdAt + 20 * DAY), // appris depuis
      log("山|", createdAt + 30 * DAY), // appris depuis
    ];
    const vocabNow = new Map([
      ["水|", vocab("水|")],
      ["火|", vocab("火|")],
      ["山|", vocab("山|")],
      // 川| jamais suivi
    ]);
    const d = computeMirrorDelta(ids, reviews, vocabNow, createdAt);
    expect(d.totalWords).toBe(4);
    expect(d.knownThen).toBe(1);
    expect(d.knownNow).toBe(3);
    expect(d.newSince.sort()).toEqual(["火", "山"].sort());
  });

  it("dédoublonne les ids et plafonne l'échantillon à 8", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}|`).flatMap((id) => [id, id]);
    const vocabNow = new Map(ids.map((id) => [id, vocab(id)]));
    const d = computeMirrorDelta(ids, [], vocabNow, createdAt);
    expect(d.totalWords).toBe(12);
    expect(d.knownThen).toBe(0);
    expect(d.knownNow).toBe(12);
    expect(d.newSince).toHaveLength(8);
  });
});
