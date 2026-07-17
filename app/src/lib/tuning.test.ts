import { describe, expect, it } from "vitest";
import { SRS } from "./config";
import {
  computeTunedRetention,
  effectiveNewPerDay,
  MIN_SAMPLE,
  RETENTION_MAX,
  RETENTION_MIN,
  TARGET_RETENTION,
} from "./tuning";

describe("computeTunedRetention", () => {
  it("reste inchangé sous le seuil d'échantillon", () => {
    expect(computeTunedRetention(0.9, 0.5, MIN_SAMPLE - 1)).toBe(0.9);
  });

  it("reste inchangé sans mesure", () => {
    expect(computeTunedRetention(0.88, null, 999)).toBe(0.88);
  });

  it("relève la cible quand l'utilisateur rate beaucoup (rétention < cible)", () => {
    // measured 0.80 → err = +0.10 → +0.5*0.10 = +0.05
    expect(computeTunedRetention(0.9, 0.8, 100)).toBeCloseTo(0.95, 5);
  });

  it("abaisse la cible quand l'utilisateur réussit trop (rétention > cible)", () => {
    // measured 0.98 → err = -0.08 → -0.04
    expect(computeTunedRetention(0.9, 0.98, 100)).toBeCloseTo(0.86, 5);
  });

  it("ne bouge pas dans la zone morte (hystérésis)", () => {
    // measured 0.89 → |err| = 0.01 < 0.02
    expect(computeTunedRetention(0.9, 0.89, 100)).toBe(0.9);
  });

  it("borne la cible dans [RETENTION_MIN, RETENTION_MAX]", () => {
    expect(computeTunedRetention(0.96, 0.4, 100)).toBeLessThanOrEqual(RETENTION_MAX);
    expect(computeTunedRetention(0.82, 1, 100)).toBeGreaterThanOrEqual(RETENTION_MIN);
  });

  it("cible = défaut FSRS", () => {
    expect(TARGET_RETENTION).toBe(0.9);
  });
});

describe("effectiveNewPerDay", () => {
  const base = 10;

  it("plein régime quand tout va bien", () => {
    expect(effectiveNewPerDay(base, 0.9, 5)).toBe(base);
    expect(effectiveNewPerDay(base, null, 0)).toBe(base);
  });

  it("réduit à 75 % sur un backlog modéré", () => {
    expect(effectiveNewPerDay(base, 0.9, SRS.sessionCap + 1)).toBe(Math.round(base * 0.75));
  });

  it("réduit de moitié quand l'utilisateur peine OU backlog lourd", () => {
    expect(effectiveNewPerDay(base, 0.7, 0)).toBe(Math.round(base / 2)); // struggling
    expect(effectiveNewPerDay(base, 0.95, 2 * SRS.sessionCap + 1)).toBe(Math.round(base / 2)); // heavy
  });

  it("coupe les nouveautés quand l'utilisateur peine ET accumule", () => {
    expect(effectiveNewPerDay(base, 0.6, 2 * SRS.sessionCap + 1)).toBe(0);
  });
});
