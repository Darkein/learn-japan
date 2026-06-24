import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getVocab } from "./db";
import { applyStatus, itemIdFor } from "./vocab";
import type { KuromojiToken } from "./tokenizer";

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
