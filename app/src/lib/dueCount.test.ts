import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetDbForTests, getDB, putMeta, putVocab, type VocabItem } from "./db";
import { countDueFromIndexedDB, countDueItems, readMetaRaw, writeMetaRaw } from "./dueCount";
import { newCard, review } from "./srs";

const NOW = new Date("2026-07-05T12:00:00");

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

function card(dueInDays: number) {
  return { due: new Date(NOW.getTime() + dueInDays * 24 * 3600e3) };
}

describe("countDueItems (pur)", () => {
  it("compte toutes les cartes dues, toutes compétences confondues", () => {
    const vocab = [
      { cards: { written: card(-1), oral: card(-2), production: card(3) } }, // 2 dues
      { cards: { written: card(5) } }, // 0
      { cards: {} }, // jamais appris — pas dû
    ];
    const grammar = [{ card: card(-10) }, { card: card(1) }, {}];
    const comprehension = [{ card: card(0) }]; // due à l'instant
    expect(countDueItems(vocab, grammar, comprehension, NOW)).toBe(4);
  });

  it("inclut l'horizon +15 min (cartes imminentes)", () => {
    const soon = { due: new Date(NOW.getTime() + 10 * 60 * 1000) };
    const later = { due: new Date(NOW.getTime() + 20 * 60 * 1000) };
    expect(countDueItems([{ cards: { written: soon } }], [], [], NOW)).toBe(1);
    expect(countDueItems([{ cards: { written: later } }], [], [], NOW)).toBe(0);
  });
});

describe("accès IndexedDB brut (partagé avec le service worker)", () => {
  it("countDueFromIndexedDB compte comme l'app", async () => {
    const overdue = review(newCard(new Date(NOW.getTime() - 30 * 24 * 3600e3)), "good", new Date(NOW.getTime() - 20 * 24 * 3600e3));
    const item: VocabItem = {
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: overdue },
    };
    await putVocab(item); // crée la base + les stores via getDB
    expect(await countDueFromIndexedDB(NOW)).toBe(1);
  });

  it("renvoie 0 sans base ni stores", async () => {
    expect(await countDueFromIndexedDB(NOW)).toBe(0);
  });

  it("readMetaRaw/writeMetaRaw parlent au même store que db.ts", async () => {
    await getDB(); // matérialise le schéma v12
    await putMeta("reminders", { enabled: true, hour: 9 });
    expect(await readMetaRaw<{ enabled: boolean }>("reminders")).toMatchObject({ enabled: true });
    await writeMetaRaw("reminder.lastShown", "2026-07-05");
    expect(await readMetaRaw<string>("reminder.lastShown")).toBe("2026-07-05");
  });
});
