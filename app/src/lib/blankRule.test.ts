import { describe, expect, it } from "vitest";
import { blankRuleFor } from "./blankRule";

// Les règles viennent du référentiel réel (app/src/data/inventory/grammar.json) : un id de
// la table qui n'y serait pas ne produirait aucune règle, ce que ces tests attraperaient.
describe("blankRuleFor — la règle qui commande le radical masqué", () => {
  it("radical devant ます : la terminaison polie", () => {
    // 「今日、私は日本語を勉強◯◯ます。」 → le trou attend し, pas する : voilà pourquoi.
    expect(blankRuleFor("し", "ます。")).toEqual({
      name: "ます (poli)",
      rule: "Terminaison verbale polie au présent/futur.",
    });
  });

  it("terminaison la plus longue d'abord", () => {
    expect(blankRuleFor("し", "ませんでした。")?.name).toBe("ませんでした (passé négatif poli)");
    expect(blankRuleFor("し", "ません。")?.name).toBe("ません (négation polie)");
    expect(blankRuleFor("し", "ました。")?.name).toBe("ました (passé poli)");
    expect(blankRuleFor("し", "ましょう。")?.name).toBe("ましょう (invitation)");
    expect(blankRuleFor("し", "たいです。")?.name).toBe("たい (vouloir faire)");
  });

  it("une construction bâtie sur la て-forme s'explique par la て-forme", () => {
    // Le trou ne porte que le radical : て le commande, quoi qu'on bâtisse après.
    expect(blankRuleFor("し", "てから、寝ます。")?.name).toBe("て-forme");
    expect(blankRuleFor("し", "てもいいです。")?.name).toBe("て-forme");
    // Sauf ce que le référentiel nomme lui-même : ている, てください.
    expect(blankRuleFor("し", "ています。")?.name).toBe("ている (action en cours)");
    expect(blankRuleFor("し", "てください。")?.name).toBe("てください (demande)");
  });

  it("radical sonorisé (読ん + で／だ)", () => {
    expect(blankRuleFor("よん", "で、寝ます。")?.name).toBe("て-forme");
    expect(blankRuleFor("よん", "だ。")?.name).toBe("た (passé neutre)");
  });

  it("l'adjectif en -い ne prend pas les règles du verbe", () => {
    expect(blankRuleFor("あつく", "ない。")?.name).toBe("adjectif -い négatif (くない)");
    expect(blankRuleFor("あつかっ", "た。")?.name).toBe("adjectif -い passé (かった)");
    // Un radical de verbe devant ない garde, lui, la négation neutre.
    expect(blankRuleFor("し", "ない。")?.name).toBe("ない (négation neutre)");
  });

  it("rien de connu après le trou : aucune règle plutôt qu'une au hasard", () => {
    expect(blankRuleFor("し", "")).toBeNull();
    expect(blankRuleFor("ねこ", "が走る。")).toBeNull();
  });
});
