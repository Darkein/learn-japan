import { describe, expect, it } from "vitest";
import { PEAK_COVERAGE, scoreStory } from "./recommend";

describe("scoreStory", () => {
  it("écarte un texte sans mot de contenu", () => {
    expect(scoreStory(1, 0, 0)).toBe(-Infinity);
  });

  it("maximise la bande au pic de couverture", () => {
    const peak = scoreStory(PEAK_COVERAGE, 100, 0);
    expect(peak).toBeCloseTo(1, 5);
    expect(peak).toBeGreaterThan(scoreStory(PEAK_COVERAGE - 0.1, 100, 0));
    expect(peak).toBeGreaterThan(scoreStory(PEAK_COVERAGE + 0.05, 100, 0));
  });

  it("pénalise plus vite le trop-facile que le trop-dur (à écart égal du pic)", () => {
    const harder = scoreStory(PEAK_COVERAGE - 0.05, 100, 0); // un peu dur : valeur d'apprentissage
    const easier = scoreStory(PEAK_COVERAGE + 0.05, 100, 0); // trop facile : n'apprend rien
    expect(easier).toBeLessThan(harder);
  });

  it("un texte trop dur tombe à un score non positif", () => {
    expect(scoreStory(0.6, 100, 0)).toBeLessThanOrEqual(0);
  });

  it("bonus croissant avec les mots dus, à couverture égale", () => {
    const none = scoreStory(0.9, 100, 0);
    const some = scoreStory(0.9, 100, 4);
    const many = scoreStory(0.9, 100, 20);
    expect(some).toBeGreaterThan(none);
    expect(many).toBeGreaterThan(some);
  });

  it("plafonne le bonus de mots dus", () => {
    expect(scoreStory(0.9, 100, 8)).toBeCloseTo(scoreStory(0.9, 100, 50), 5);
  });
});
