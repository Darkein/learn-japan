import { describe, expect, it } from "vitest";
import { parseStoryTranslation } from "./genClient";

// La composition des prompts (cadrage, histoire, traduction) vit désormais côté Worker
// — voir worker/src/prompts.test.ts. Le client ne fait plus que parser la réponse.

describe("parseStoryTranslation", () => {
  it("extrait le titre et aligne les traductions numérotées", () => {
    const raw = [
      "TITRE: Le chat et l'eau",
      "1. Le chat boit de l'eau.",
      "2. Puis il dort.",
      "3. Le matin, il a faim.",
    ].join("\n");
    const r = parseStoryTranslation(raw, 3);
    expect(r.titleFr).toBe("Le chat et l'eau");
    expect(r.sentences).toEqual([
      "Le chat boit de l'eau.",
      "Puis il dort.",
      "Le matin, il a faim.",
    ]);
  });

  it("complète dans l'ordre si la numérotation manque (repli)", () => {
    const raw = ["TITRE: Sans numéros", "Première phrase.", "Deuxième phrase."].join("\n");
    const r = parseStoryTranslation(raw, 2);
    expect(r.titleFr).toBe("Sans numéros");
    expect(r.sentences).toEqual(["Première phrase.", "Deuxième phrase."]);
  });

  it("garde une longueur égale au nombre de phrases JP", () => {
    const r = parseStoryTranslation("TITRE: x\n1. a", 3);
    expect(r.sentences).toHaveLength(3);
  });
});
