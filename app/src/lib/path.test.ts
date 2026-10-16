import { describe, expect, it } from "vitest";
import type { GrammarItem, VocabItem } from "./db";
import {
  PATH_STEPS,
  isPreAcquiredGrammar,
  isPreAcquiredVocab,
  lessonSteps,
  nextStep,
  stepNumber,
} from "./path";
import { newCard, State } from "./srs";

const entry = (vocab: number, grammar: number) => ({
  introduces: {
    vocab: Array.from({ length: vocab }, (_, i) => `v${i}`),
    grammar: Array.from({ length: grammar }, (_, i) => `g${i}`),
  },
});

describe("lessonSteps — les étapes d'une leçon", () => {
  it("les sept étapes, dans l'ordre, pour une leçon complète", () => {
    expect(lessonSteps(entry(8, 2))).toEqual(["course", "vocab", "grammar", "review", "story", "produce", "exam"]);
  });

  it("une leçon sans grammaire saute l'étape Grammaire", () => {
    expect(lessonSteps(entry(14, 0))).not.toContain("grammar");
    expect(lessonSteps(entry(14, 0))).toHaveLength(6);
  });

  it("une leçon sans vocabulaire saute l'étape Vocabulaire", () => {
    expect(lessonSteps(entry(0, 2))).not.toContain("vocab");
  });
});

describe("nextStep / stepNumber", () => {
  it("la première étape pas encore faite, dans l'ordre du parcours", () => {
    expect(nextStep(PATH_STEPS, new Set())).toBe("course");
    expect(nextStep(PATH_STEPS, new Set(["course", "grammar"]))).toBe("vocab");
    expect(nextStep(PATH_STEPS, new Set(PATH_STEPS))).toBeUndefined();
  });

  it("le rang d'une étape dans le parcours de sa leçon", () => {
    const steps = lessonSteps(entry(14, 0));
    expect(stepNumber(steps, "review")).toBe(3);
    expect(stepNumber(steps, "exam")).toBe(6);
  });
});

describe("éléments déjà acquis (dispense des étapes de découverte)", () => {
  const word = (over: Partial<VocabItem>): VocabItem => ({
    id: "人|ひと",
    surface: "人",
    reading: "ひと",
    meaning: "personne",
    tags: [],
    status: "unknown",
    ...over,
  });

  it("acquis : carte en état Review, ou déclaré connu", () => {
    expect(isPreAcquiredVocab(word({ card: { ...newCard(), state: State.Review } }))).toBe(true);
    expect(isPreAcquiredVocab(word({ status: "known" }))).toBe(true);
  });

  it("pas acquis : absent, sans carte, ou carte encore en apprentissage", () => {
    expect(isPreAcquiredVocab(undefined)).toBe(false);
    expect(isPreAcquiredVocab(word({}))).toBe(false);
    expect(isPreAcquiredVocab(word({ card: { ...newCard(), state: State.Learning } }))).toBe(false);
  });

  it("un mot que la révision ne sait pas servir ne retient pas l'étape", () => {
    expect(isPreAcquiredVocab(word({ surface: "ねこ", reading: "ねこ", meaning: "—" }))).toBe(true);
  });

  it("même règle pour la grammaire", () => {
    const g: GrammarItem = { id: "n5-iru", name: "いる", rule: "", examples: [], tags: [], status: "unknown" };
    expect(isPreAcquiredGrammar(g)).toBe(false);
    expect(isPreAcquiredGrammar({ ...g, card: { ...newCard(), state: State.Review } })).toBe(true);
  });
});
