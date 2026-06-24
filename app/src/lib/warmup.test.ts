import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { putVocab } from "./db";
import { newCard } from "./srs";
import { dueCards, gradeCard } from "./warmup";

describe("échauffement SRS", () => {
  it("liste les cartes dues, puis les retire après une bonne réponse", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) }, // due en 2020 → en retard
    });

    const now = new Date("2026-06-24T08:00:00Z");
    const due = await dueCards(now);
    const card = due.find((c) => c.id === "水|みず");
    expect(card).toBeDefined();
    expect(card!.front).toBe("eau");
    expect(card!.back).toBe("水（みず）");

    await gradeCard(card!, "good", now);
    const due2 = await dueCards(now);
    expect(due2.find((c) => c.id === "水|みず")).toBeUndefined();
  });
});
