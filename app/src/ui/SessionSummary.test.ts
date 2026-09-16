import { describe, expect, it } from "vitest";
import { SRS } from "../lib/config";
import { summaryBadge } from "./SessionSummary";

/** Entrée de bilan minimale : seuls les champs lus par `summaryBadge`. */
function entry(over: Partial<Parameters<typeof summaryBadge>[0]> = {}) {
  return { mastered: false, unlockReady: false, intervalDays: 0, intervalDaysBefore: 0, ...over };
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

  it("au-delà du seuil de déblocage, l'élément est « débloquant »", () => {
    expect(summaryBadge(entry({ unlockReady: true, intervalDays: SRS.unlockIntervalDays }))).toEqual({
      label: "débloquant",
      variant: "accent",
    });
  });

  it("la maîtrise prime sur le déblocage", () => {
    const e = entry({ mastered: true, unlockReady: true, intervalDays: SRS.masteredIntervalDays });
    expect(summaryBadge(e)).toEqual({ label: "maîtrisé", variant: "accent" });
  });

  it("entre zéro et le seuil de déblocage, pas de badge : la barre suffit", () => {
    expect(summaryBadge(entry({ intervalDays: 2, intervalDaysBefore: 1 }))).toBeNull();
  });
});
