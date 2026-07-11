import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getVocab, type VocabItem } from "./db";
import { addInventoryWordToReview, applyStatus, effectiveExample, itemIdFor } from "./vocab";
import type { KuromojiToken } from "./tokenizer";

vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: (id: string) =>
    id === "猫|ねこ" ? { ja: "猫は水を飲みます。", fr: "Le chat boit de l'eau." } : null,
}));

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

describe("vocab ↔ SRS (IndexedDB)", () => {
  it("persiste un item et planifie la compétence écrite", async () => {
    const neko = tok({ surface_form: "猫", pos: "名詞", basic_form: "猫", reading: "ネコ" });
    const id = itemIdFor(neko);

    const item = await applyStatus(neko, "review", new Date("2026-06-23T08:00:00Z"));
    expect(item.status).toBe("review");
    expect(item.cards.written).toBeDefined();

    const reloaded = await getVocab(id);
    expect(reloaded?.id).toBe(id);
    expect(reloaded?.status).toBe("review");
    expect(reloaded?.cards.written?.due).toBeInstanceOf(Date);
  });

  it("« Je connais » marque l'item comme connu", async () => {
    const inu = tok({ surface_form: "犬", pos: "名詞", basic_form: "犬", reading: "イヌ" });
    const item = await applyStatus(inu, "known");
    expect(item.status).toBe("known");
    expect((await getVocab(itemIdFor(inu)))?.status).toBe("known");
  });
});

describe("addInventoryWordToReview", () => {
  const inv = { id: "毎日|まいにち", ja: "毎日", yomi: "まいにち", fr: "tous les jours", level: 5 };

  it("crée l'item en « à revoir » avec la carte écrite planifiée et journalise", async () => {
    const item = await addInventoryWordToReview(inv, new Date("2026-06-23T08:00:00Z"));
    expect(item.status).toBe("review");
    expect(item.cards.written?.due).toBeInstanceOf(Date);

    const reloaded = await getVocab(inv.id);
    expect(reloaded?.surface).toBe("毎日");
    expect(reloaded?.reading).toBe("まいにち");
    expect(reloaded?.meaning).toBe("tous les jours");
    expect(reloaded?.status).toBe("review");
  });

  it("n'écrase pas un item déjà en base", async () => {
    const existing = tok({ surface_form: "水", pos: "名詞", basic_form: "水", reading: "ミズ" });
    await applyStatus(existing, "known");
    const id = itemIdFor(existing);

    const item = await addInventoryWordToReview({ id, ja: "水", yomi: "みず", fr: "eau", level: 5 });
    expect(item.status).toBe("known");
    expect((await getVocab(id))?.status).toBe("known");
  });
});

describe("effectiveExample", () => {
  function vocab(p: Partial<VocabItem> & { id: string }): VocabItem {
    return { surface: "猫", reading: "ねこ", meaning: "chat", tags: [], status: "review", cards: {}, ...p };
  }

  it("préfère l'exemple issu d'une histoire lue", () => {
    const v = vocab({ id: "猫|ねこ", example: { ja: "猫がいます。" } });
    expect(effectiveExample(v)?.ja).toBe("猫がいます。");
  });

  it("retombe sur le corpus statique quand l'item n'a pas d'exemple", () => {
    const v = vocab({ id: "猫|ねこ" });
    expect(effectiveExample(v)).toEqual({ ja: "猫は水を飲みます。", fr: "Le chat boit de l'eau." });
  });

  it("null quand ni exemple d'histoire ni corpus", () => {
    expect(effectiveExample(vocab({ id: "犬|いぬ" }))).toBeNull();
  });
});
