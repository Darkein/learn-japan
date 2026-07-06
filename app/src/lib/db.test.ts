import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { openDB } from "idb";
import {
  _resetDbForTests,
  allEncounters,
  bumpSrsDaily,
  getDB,
  getEncounter,
  getMeta,
  getOmikuji,
  getSrsDaily,
  getVocab,
  putEncounter,
  putMeta,
  putOmikuji,
  type OmikujiRecord,
} from "./db";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe("migration v12", () => {
  it("crée les stores encounters/omikuji/meta", async () => {
    const db = await getDB();
    expect(db.objectStoreNames).toContain("encounters");
    expect(db.objectStoreNames).toContain("omikuji");
    expect(db.objectStoreNames).toContain("meta");
  });

  it("préserve les données d'une base v11 existante", async () => {
    // Base v11 : mêmes stores qu'avant la v12, avec un vocab et un compteur journalier.
    const v11 = await openDB("learn-japan", 11, {
      upgrade(db) {
        db.createObjectStore("vocab", { keyPath: "id" }).createIndex("status", "status");
        db.createObjectStore("srsDaily", { keyPath: "date" });
      },
    });
    await v11.put("vocab", {
      id: "暗記|あんき",
      surface: "暗記",
      reading: "あんき",
      meaning: "mémorisation",
      tags: [],
      status: "known",
      cards: {},
    });
    await v11.put("srsDaily", { date: "2026-07-01", introduced: 3, reviewed: 12 });
    v11.close();

    const vocab = await getVocab("暗記|あんき");
    expect(vocab?.meaning).toBe("mémorisation");
    const daily = await getSrsDaily("2026-07-01");
    expect(daily).toMatchObject({ introduced: 3, reviewed: 12 });
    expect((await getDB()).objectStoreNames).toContain("meta");
  });
});

describe("bumpSrsDaily", () => {
  it("additionne les nouveaux champs sans écraser introduced/reviewed", async () => {
    await bumpSrsDaily("2026-07-05", { introduced: 2, reviewed: 5 });
    await bumpSrsDaily("2026-07-05", { flowMs: 60_000, storiesRead: 1 });
    await bumpSrsDaily("2026-07-05", { flowMs: 60_000, reviewed: 3 });
    const rec = await getSrsDaily("2026-07-05");
    expect(rec).toMatchObject({
      introduced: 2,
      reviewed: 8,
      flowMs: 120_000,
      storiesRead: 1,
    });
  });

  it("tolère un enregistrement ancien sans les champs v12", async () => {
    const db = await getDB();
    await db.put("srsDaily", { date: "2026-06-01", introduced: 1, reviewed: 4 });
    await bumpSrsDaily("2026-06-01", { flowMs: 30_000 });
    const rec = await getSrsDaily("2026-06-01");
    expect(rec).toMatchObject({ introduced: 1, reviewed: 4, flowMs: 30_000 });
  });
});

describe("helpers v12", () => {
  it("encounters : put/get/all", async () => {
    await putEncounter({ id: "水|みず", count: 2, firstAt: 1, lastAt: 2, lastStoryId: "s1" });
    expect((await getEncounter("水|みず"))?.count).toBe(2);
    expect(await allEncounters()).toHaveLength(1);
  });

  it("omikuji : un enregistrement par date", async () => {
    const rec: OmikujiRecord = {
      date: "2026-07-05",
      challengeId: "story-1",
      fortune: "kichi",
      drawnAt: Date.now(),
      baseline: { reviewed: 0, prodOk: 0, oralOk: 0, storiesRead: 0 },
    };
    await putOmikuji(rec);
    expect((await getOmikuji("2026-07-05"))?.challengeId).toBe("story-1");
    expect(await getOmikuji("2026-07-04")).toBeUndefined();
  });

  it("meta : KV typé", async () => {
    await putMeta("tokaido.maxReached", 3.5);
    expect(await getMeta<number>("tokaido.maxReached")).toBe(3.5);
    expect(await getMeta("absent")).toBeUndefined();
  });
});
