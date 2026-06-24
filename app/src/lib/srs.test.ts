import { describe, expect, it } from "vitest";
import { isDue, newCard, review } from "./srs";

describe("SRS (FSRS)", () => {
  it("une carte vierge est due immédiatement", () => {
    const now = new Date("2026-06-23T08:00:00Z");
    expect(isDue(newCard(now), now)).toBe(true);
  });

  it("une bonne réponse repousse l'échéance dans le futur", () => {
    const now = new Date("2026-06-23T08:00:00Z");
    const card = review(newCard(now), "good", now);
    expect(card.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card.reps).toBeGreaterThanOrEqual(1);
  });

  it("'again' replanifie plus tôt que 'easy'", () => {
    const now = new Date("2026-06-23T08:00:00Z");
    const base = newCard(now);
    const again = review(base, "again", now);
    const easy = review(base, "easy", now);
    expect(again.due.getTime()).toBeLessThan(easy.due.getTime());
  });
});
