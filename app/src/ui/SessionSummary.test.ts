import { describe, expect, it } from "vitest";
import { SRS } from "../lib/config";
import { summaryBadge } from "./SessionSummary";

/** Entrée de bilan minimale : seuls les champs lus par `summaryBadge`. */
function entry(over: Partial<Parameters<typeof summaryBadge>[0]> = {}) {
  return { mastered: false, intervalDays: 0, intervalDaysBefore: 0, ...over };
}

describe("summaryBadge", () => {
  it("un élément jamais stabilisé est « nouveau »", () => {
    expect(summaryBadge(entry())).toEqual({ label: "nouveau", variant: "default" });
  });

  it("un élément qui tenait plusieurs jours et retombe à zéro est « oublié », pas « nouveau »", () => {
    expect(summaryBadge(entry({ intervalDaysBefore: 8 }))).toEqual({
      label: "oublié",
      variant: "default",
    });
  });

  it("l'élément maîtrisé est le seul palier haut qui porte un badge", () => {
    const e = entry({ mastered: true, intervalDays: SRS.masteredIntervalDays });
    expect(summaryBadge(e)).toEqual({ label: "maîtrisé", variant: "accent" });
  });

  it("le seuil de déblocage ne porte AUCUN badge : il sert la leçon, pas l'apprenant", () => {
    expect(summaryBadge(entry({ intervalDays: SRS.unlockIntervalDays }))).toBeNull();
  });

  it("tout l'entre-deux reste sans badge : la barre raconte la progression", () => {
    expect(summaryBadge(entry({ intervalDays: 2, intervalDaysBefore: 1 }))).toBeNull();
    expect(summaryBadge(entry({ intervalDays: SRS.masteredIntervalDays - 1 }))).toBeNull();
  });
});
