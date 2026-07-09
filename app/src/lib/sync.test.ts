// Sync cloud : intégrité du roundtrip export → gzip → gunzip → import (Dates FSRS
// revivées, meta locales préservées), stabilité de l'empreinte, cap du journal,
// codes de session. Le transport (Worker) est testé côté worker/src/progress.test.ts.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import {
  _resetDbForTests,
  getDB,
  getMeta,
  getVocab,
  putMeta,
  type VocabItem,
} from "./db";
import {
  exportSnapshot,
  generateSyncCode,
  gunzipJson,
  gzipJson,
  importSnapshot,
  normalizeSyncCode,
  snapshotHash,
  type SyncSnapshot,
} from "./sync";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

function vocabItem(id: string): VocabItem {
  return {
    id,
    surface: id.split("|")[0],
    reading: id.split("|")[1] ?? "",
    meaning: "sens",
    tags: [],
    status: "review",
    cards: { written: createEmptyCard(new Date("2026-07-01T10:00:00Z")) },
  };
}

describe("code de session", () => {
  it("génère un code au bon format, normalisable", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateSyncCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(normalizeSyncCode(code)).toBe(code);
    }
  });

  it("normalise une saisie relâchée, rejette l'invalide", () => {
    expect(normalizeSyncCode(" k7mp x2r9 4tqf ")).toBe("K7MP-X2R9-4TQF");
    expect(normalizeSyncCode("K7MPX2R94TQF")).toBe("K7MP-X2R9-4TQF");
    expect(normalizeSyncCode("trop-court")).toBeNull();
    expect(normalizeSyncCode("K7MP-X2R9-4TQ0")).toBeNull(); // 0 interdit
  });
});

describe("export / import", () => {
  it("roundtrip complet via gzip : Dates FSRS revivées, données identiques", async () => {
    const db = await getDB();
    await db.put("vocab", vocabItem("暗記|あんき"));
    await db.put("stories", {
      id: "s1", createdAt: 1, title: "物語", text: "テキスト。", params: { level: 5 },
    });

    const snapshot = await exportSnapshot();
    const restored = await gunzipJson<SyncSnapshot>(await gzipJson(snapshot));

    // Nouvelle base vierge (simule le second appareil).
    (globalThis as any).indexedDB = new IDBFactory();
    _resetDbForTests();
    await importSnapshot(restored);

    const v = await getVocab("暗記|あんき");
    expect(v).toBeDefined();
    expect(v!.cards.written!.due).toBeInstanceOf(Date);
    expect(v!.cards.written!.due.getTime()).toBe(new Date("2026-07-01T10:00:00Z").getTime());
    const stories = await (await getDB()).getAll("stories");
    expect(stories).toHaveLength(1);
    expect(stories[0].text).toBe("テキスト。");
  });

  it("exclut les meta locales de l'export et les préserve à l'import", async () => {
    await putMeta("sync:code", "K7MP-X2R9-4TQF");
    await putMeta("storyImageTried:s1", true);
    await putMeta("tokaido.bonus", 3);

    const snapshot = await exportSnapshot();
    const keys = snapshot.stores.meta.map((m) => m.key);
    expect(keys).toContain("tokaido.bonus");
    expect(keys.some((k) => k.startsWith("sync:") || k.startsWith("storyImageTried:"))).toBe(false);

    // Import d'un snapshot étranger : le code local de CET appareil survit.
    await importSnapshot(snapshot);
    expect(await getMeta("sync:code")).toBe("K7MP-X2R9-4TQF");
    expect(await getMeta("tokaido.bonus")).toBe(3);
  });

  it("refuse une sauvegarde d'un schéma plus récent", async () => {
    const snapshot = await exportSnapshot();
    await expect(importSnapshot({ ...snapshot, dbVersion: 999 })).rejects.toThrow(/mets à jour/);
  });

  it("borne le journal de révisions à l'export", async () => {
    const db = await getDB();
    const tx = db.transaction("reviews", "readwrite");
    for (let i = 0; i < 20_050; i++) {
      void tx.store.add({ itemId: `w${i}`, track: "vocab", grade: "good", at: i });
    }
    await tx.done;
    const snapshot = await exportSnapshot();
    expect(snapshot.stores.reviews).toHaveLength(20_000);
    // On garde la FIN du journal (les plus récents).
    expect(snapshot.stores.reviews.at(-1)!.at).toBe(20_049);
  });
});

describe("empreinte", () => {
  it("stable entre deux exports du même contenu, sensible au contenu", async () => {
    const db = await getDB();
    await db.put("vocab", vocabItem("水|みず"));
    const h1 = await snapshotHash(await exportSnapshot());
    const h2 = await snapshotHash(await exportSnapshot());
    expect(h1).toBe(h2); // exportedAt exclu de l'empreinte

    await db.put("vocab", vocabItem("火|ひ"));
    expect(await snapshotHash(await exportSnapshot())).not.toBe(h1);
  });
});
