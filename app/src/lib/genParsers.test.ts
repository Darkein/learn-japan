import { describe, expect, it } from "vitest";
import { parseComprehensionQcm, parseMnemonicBatch, parseStoryTranslation } from "./genParsers";

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

describe("parseComprehensionQcm", () => {
  const grammarIds = ["n5-wa-topic", "n5-soshite"];

  it("extrait questions, propositions et la bonne réponse, et résout le tag [Gk]", () => {
    const raw = [
      "1. [G2] Que fait le chat ensuite ?",
      "+ Il dort.",
      "- Il mange.",
      "- Il part.",
      "- Il pleut.",
    ].join("\n");
    const r = parseComprehensionQcm(raw, grammarIds);
    expect(r).toHaveLength(1);
    expect(r[0].question).toBe("Que fait le chat ensuite ?");
    expect(r[0].targetGrammarId).toBe("n5-soshite");
    expect(r[0].options).toHaveLength(4);
    // La bonne réponse est « Il dort. », quel que soit l'ordre après mélange.
    expect(r[0].options[r[0].answerIndex]).toBe("Il dort.");
    expect(r[0].options).toContain("Il mange.");
  });

  it("traite [G0] (et un tag hors plage) comme « aucun point précis »", () => {
    const raw = ["1. [G0] Question générale ?", "+ Bonne", "- Mauvaise"].join("\n");
    expect(parseComprehensionQcm(raw, grammarIds)[0].targetGrammarId).toBeUndefined();
    const raw2 = ["1. [G9] Hors plage ?", "+ Bonne", "- Mauvaise"].join("\n");
    expect(parseComprehensionQcm(raw2, grammarIds)[0].targetGrammarId).toBeUndefined();
  });

  it("ignore une question sans bonne réponse ou avec moins de deux propositions", () => {
    const raw = [
      "1. [G1] Sans bonne réponse ?",
      "- A",
      "- B",
      "2. [G1] Une seule proposition ?",
      "+ Seule",
      "3. [G1] Valide ?",
      "+ Oui",
      "- Non",
    ].join("\n");
    const r = parseComprehensionQcm(raw, grammarIds);
    expect(r).toHaveLength(1);
    expect(r[0].question).toBe("Valide ?");
  });

  it("tolère le tag absent et la numérotation entre crochets", () => {
    const raw = ["[1] Pas de tag ?", "+ Bonne", "- Mauvaise"].join("\n");
    const r = parseComprehensionQcm(raw, grammarIds);
    expect(r[0].question).toBe("Pas de tag ?");
    expect(r[0].targetGrammarId).toBeUndefined();
  });
});

describe("parseMnemonicBatch", () => {
  it("aligne les lignes numérotées « N. mnémo || composition »", () => {
    const raw = [
      "1. Le NOMade assoiffé BOIT (のむ). || 食 manger + 欠 bâiller : bouche ouverte pour avaler.",
      "2. « ITCHi » : UN seul trait, ça démange. || Un trait horizontal.",
    ].join("\n");
    const out = parseMnemonicBatch(raw, 2);
    expect(out[0]).toEqual({
      story: "Le NOMade assoiffé BOIT (のむ).",
      composition: "食 manger + 欠 bâiller : bouche ouverte pour avaler.",
    });
    expect(out[1]!.story).toContain("UN seul trait");
  });

  it("laisse un trou (null) pour une ligne manquante, longueur = n", () => {
    const out = parseMnemonicBatch("2. a || b", 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBeNull();
    expect(out[1]).toEqual({ story: "a", composition: "b" });
    expect(out[2]).toBeNull();
  });

  it("ignore les lignes non numérotées et rattache un champ surnuméraire à la composition", () => {
    const out = parseMnemonicBatch("Voici :\n1. mnémo || part1 || part2", 1);
    expect(out[0]).toEqual({ story: "mnémo", composition: "part1 part2" });
  });

  it("composition vide acceptée (mot en kana), ligne vide refusée", () => {
    expect(parseMnemonicBatch("1. juste le mnémo ||", 1)[0]).toEqual({
      story: "juste le mnémo",
      composition: "",
    });
    expect(parseMnemonicBatch("1.  || ", 1)[0]).toBeNull();
  });
});
