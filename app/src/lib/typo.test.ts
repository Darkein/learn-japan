import { describe, expect, it } from "vitest";
import { isNearMiss } from "./typo";

describe("isNearMiss", () => {
  it("accepte une substitution", () => {
    expect(isNearMiss("たへもの", "たべもの")).toBe(true);
  });

  it("accepte une insertion (entrée plus longue)", () => {
    expect(isNearMiss("たべものの", "たべもの")).toBe(true);
  });

  it("accepte une suppression (entrée plus courte)", () => {
    expect(isNearMiss("たべも", "たべもの")).toBe(true);
  });

  it("accepte une transposition adjacente", () => {
    expect(isNearMiss("しゆくだい", "しゅくだい")).toBe(true);
    expect(isNearMiss("たもべの", "たべもの")).toBe(true);
  });

  it("rejette l'égalité (correct, pas une coquille)", () => {
    expect(isNearMiss("たべもの", "たべもの")).toBe(false);
  });

  it("rejette une réponse attendue trop courte", () => {
    expect(isNearMiss("かき", "かぎ")).toBe(false);
    expect(isNearMiss("は", "が")).toBe(false);
  });

  it("rejette deux éditions ou plus", () => {
    expect(isNearMiss("たへもや", "たべもの")).toBe(false);
    expect(isNearMiss("たべものです", "たべもの")).toBe(false);
    expect(isNearMiss("のもべた", "たべもの")).toBe(false);
  });

  it("rejette une transposition non adjacente", () => {
    expect(isNearMiss("のべもた", "たべもの")).toBe(false);
  });
});
