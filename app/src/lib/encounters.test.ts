import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetDbForTests,
  getEncounter,
  getSrsDaily,
  localDateString,
  logReview,
  putVocab,
  type VocabItem,
} from "./db";
import { encounterInfo, recordEncounters } from "./encounters";
import { newCard } from "./srs";

const NOW = new Date("2026-07-05T12:00:00");

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

function vocab(id: string, learned: boolean): VocabItem {
  return {
    id,
    surface: id.split("|")[0],
    reading: id.split("|")[1] ?? "",
    meaning: "—",
    tags: [],
    status: learned ? "known" : "unknown",
    cards: learned ? { written: newCard(NOW) } : {},
  };
}

describe("recordEncounters", () => {
  it("ne compte que les mots déjà appris (carte écrite)", async () => {
    await putVocab(vocab("水|みず", true));
    await putVocab(vocab("火|ひ", false));
    const out = await recordEncounters("s1", ["水|みず", "火|ひ", "絶対|ぜったい"], NOW);
    expect(out.map((e) => e.id)).toEqual(["水|みず"]);
    expect(out[0].count).toBe(1);
    expect(await getEncounter("火|ひ")).toBeUndefined();
  });

  it("anti-rejeu : rouvrir la même histoire dans les 6 h ne recompte pas", async () => {
    await putVocab(vocab("水|みず", true));
    await recordEncounters("s1", ["水|みず"], NOW);
    const again = await recordEncounters("s1", ["水|みず"], new Date(NOW.getTime() + 60_000));
    expect(again[0].count).toBe(1);
    const later = await recordEncounters("s1", ["水|みず"], new Date(NOW.getTime() + 7 * 3600e3));
    expect(later[0].count).toBe(2);
    const other = await recordEncounters("s2", ["水|みず"], new Date(NOW.getTime() + 120_000));
    expect(other[0].count).toBe(3);
  });

  it("dédoublonne les ids d'une même histoire", async () => {
    await putVocab(vocab("水|みず", true));
    const out = await recordEncounters("s1", ["水|みず", "水|みず", "水|みず"], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(1);
  });

  it("sans storyId : information sans comptage", async () => {
    await putVocab(vocab("水|みず", true));
    const out = await recordEncounters(undefined, ["水|みず"], NOW);
    expect(out[0].count).toBe(0);
    expect(await getEncounter("水|みず")).toBeUndefined();
  });

  it("learnedAt = première entrée du log de révision", async () => {
    await putVocab(vocab("水|みず", true));
    await logReview({ itemId: "水|みず", track: "vocab", skill: "written", grade: "good", at: 1_000 });
    await logReview({ itemId: "水|みず", track: "vocab", skill: "written", grade: "easy", at: 2_000 });
    const out = await recordEncounters("s1", ["水|みず"], NOW);
    expect(out[0].learnedAt).toBe(1_000);
  });

  it("marque storiesRead une fois par jour et par histoire", async () => {
    await putVocab(vocab("水|みず", true));
    const today = localDateString(NOW);
    await recordEncounters("s1", ["水|みず"], NOW);
    await recordEncounters("s1", ["水|みず"], new Date(NOW.getTime() + 60_000));
    expect((await getSrsDaily(today))?.storiesRead).toBe(1);
    await recordEncounters("s2", [], new Date(NOW.getTime() + 120_000));
    expect((await getSrsDaily(today))?.storiesRead).toBe(2);
  });
});

describe("encounterInfo", () => {
  it("null si jamais recroisé, info sinon", async () => {
    expect(await encounterInfo("水|みず")).toBeNull();
    await putVocab(vocab("水|みず", true));
    await recordEncounters("s1", ["水|みず"], NOW);
    await recordEncounters("s2", ["水|みず"], new Date(NOW.getTime() + 60_000));
    const info = await encounterInfo("水|みず");
    expect(info?.count).toBe(2);
    expect(info?.surface).toBe("水");
  });
});
