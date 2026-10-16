import { describe, expect, it } from "vitest";
import { isAcquired, isDue, isMastered, newCard, retrievability, review } from "./srs";
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

describe("isAcquired (dispense des étapes de découverte)", () => {
  it("false sans carte, pour une carte vierge ou en apprentissage", () => {
    expect(isAcquired(undefined)).toBe(false);
    expect(isAcquired(newCard())).toBe(false);
    expect(isAcquired({ ...newCard(), state: State.Learning, scheduled_days: 30 })).toBe(false);
  });

  it("true dès l'état Review, quel que soit l'intervalle", () => {
    expect(isAcquired({ ...newCard(), state: State.Review, scheduled_days: 1 })).toBe(true);
  });
});

describe("retrievability (choix des éléments fragiles)", () => {
  it("baisse avec le temps écoulé depuis la dernière révision", () => {
    const t0 = new Date("2026-01-01T08:00:00");
    let card = review(newCard(t0), "good", t0);
    card = review(card, "good", new Date("2026-01-03T08:00:00"));
    const soon = retrievability(card, new Date("2026-01-04T08:00:00"));
    const late = retrievability(card, new Date("2026-03-01T08:00:00"));
    expect(soon).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });
});
