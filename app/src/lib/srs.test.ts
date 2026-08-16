import { describe, expect, it } from "vitest";
import { isDue, isMastered, isUnlockReady, newCard, review, spaceSkillCards } from "./srs";
import { SRS } from "./config";
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

describe("spaceSkillCards (espacement des compétences d'un même mot)", () => {
  const NOW = new Date("2026-06-23T08:00:00Z");
  const at = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
  const cardDue = (days: number) => ({ ...newCard(NOW), due: at(days) });

  it("repousse les autres compétences qui tombent dans la fenêtre", () => {
    const cards = { written: cardDue(0), oral: cardDue(1), production: cardDue(2) };
    spaceSkillCards(cards, "written", NOW);
    const floor = NOW.getTime() + SRS.skillGapDays * 24 * 60 * 60 * 1000;
    expect(cards.oral.due.getTime()).toBe(floor);
    expect(cards.production.due.getTime()).toBe(floor);
    // La carte notée n'est jamais touchée : FSRS vient de la planifier.
    expect(cards.written.due.getTime()).toBe(at(0).getTime());
  });

  it("ne touche pas une échéance déjà au-delà de la fenêtre (jamais d'avancement)", () => {
    const cards = { written: cardDue(0), oral: cardDue(30) };
    spaceSkillCards(cards, "written", NOW);
    expect(cards.oral.due.getTime()).toBe(at(30).getTime());
  });

  it("ne touche ni la stabilité ni l'historique FSRS", () => {
    const oral = { ...newCard(NOW), due: at(1), stability: 12.5, reps: 4, lapses: 1 };
    spaceSkillCards({ written: cardDue(0), oral }, "written", NOW);
    expect(oral.stability).toBe(12.5);
    expect(oral.reps).toBe(4);
    expect(oral.lapses).toBe(1);
  });
});
