import { describe, expect, it } from "vitest";
import {
  buildLessonIntroPrompt,
  buildLessonStoryPrompt,
  parseStoryTranslation,
  type LessonGenInput,
} from "./genClient";

const input: LessonGenInput = {
  title: "Les animaux",
  level: 5,
  vocab: [{ ja: "猫", yomi: "ねこ", fr: "chat" }],
  kanji: [{ ja: "猫", fr: "chat" }],
  grammar: ["n5-wa-topic"],
};

describe("buildLessonIntroPrompt", () => {
  const prompt = buildLessonIntroPrompt(input);

  it("reste court et borné (2 à 4 phrases, plus 5-9 phrases sans plafond)", () => {
    expect(prompt).toContain("2 à 4 phrases courtes");
    expect(prompt).not.toContain("5 à 9 phrases");
  });

  it("n'explique QUE la grammaire (vocab/kanji = simple matière à exemples)", () => {
    expect(prompt).toContain("Explique UNIQUEMENT la grammaire");
    expect(prompt).toContain("NE les liste PAS et NE les explique PAS");
  });
});

describe("buildLessonStoryPrompt", () => {
  it("demande au moins 2 à 3 paragraphes (plus seulement 2 à 4 courts paragraphes)", () => {
    const prompt = buildLessonStoryPrompt(input);
    expect(prompt).toContain("au moins 2 à 3 paragraphes");
    expect(prompt).not.toContain("2 à 4 courts paragraphes");
  });

  it("relève le plancher de longueur N5 (>= 240 caractères)", () => {
    const prompt = buildLessonStoryPrompt(input);
    expect(prompt).toContain("240");
  });
});

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
