import { describe, expect, it } from "vitest";
import { isDue, isMastered, isUnlockReady, newCard, review } from "./srs";
import { State } from "ts-fsrs";

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

describe("isMastered", () => {
  it("retourne false pour une carte vierge (New)", () => {
    const card = newCard();
    expect(isMastered(card)).toBe(false);
  });

  it("retourne false pour une carte en Learning avec intervalle élevé", () => {
    const card = { ...newCard(), state: State.Learning, scheduled_days: 30 };
    expect(isMastered(card)).toBe(false);
  });

  it("retourne true pour une carte Review avec intervalle ≥ 21", () => {
    const card = { ...newCard(), state: State.Review, scheduled_days: 21 };
    expect(isMastered(card)).toBe(true);
  });

  it("retourne false pour une carte Review avec intervalle < 21", () => {
    const card = { ...newCard(), state: State.Review, scheduled_days: 20 };
    expect(isMastered(card)).toBe(false);
  });
});

describe("isUnlockReady (seuil léger, découplé de la maîtrise)", () => {
  it("false pour une carte vierge ou en Learning", () => {
    expect(isUnlockReady(newCard())).toBe(false);
    expect(isUnlockReady({ ...newCard(), state: State.Learning, scheduled_days: 30 })).toBe(false);
  });

  it("true dès Review + intervalle ≥ unlockIntervalDays (bien avant 21 j)", () => {
    const card = { ...newCard(), state: State.Review, scheduled_days: 4 };
    expect(isUnlockReady(card)).toBe(true);
    expect(isMastered(card)).toBe(false);
  });

  it("false sous le seuil de déblocage", () => {
    expect(isUnlockReady({ ...newCard(), state: State.Review, scheduled_days: 3 })).toBe(false);
  });
});
