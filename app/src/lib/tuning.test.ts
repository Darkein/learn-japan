import { describe, expect, it } from "vitest";
import {
  BACKLOG_HALF_DAYS,
  BACKLOG_SLOW_DAYS,
  BACKLOG_STOP_DAYS,
  computeTunedRetention,
  effectiveNewPerDay,
  MIN_SAMPLE,
  NEW_ITEM_LOAD,
  RETENTION_MAX,
  RETENTION_MIN,
  sustainableNewPerDay,
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

describe("sustainableNewPerDay", () => {
  it("un mot neuf pour NEW_ITEM_LOAD cartes d'objectif", () => {
    expect(sustainableNewPerDay(10)).toBe(2);
    expect(sustainableNewPerDay(20)).toBe(4);
    expect(sustainableNewPerDay(50)).toBe(10);
  });

  it("jamais zéro : la progression ne se fige pas structurellement", () => {
    expect(sustainableNewPerDay(1)).toBe(1);
    expect(sustainableNewPerDay(3)).toBe(1);
  });
});

describe("effectiveNewPerDay", () => {
  const base = 10;
  // Objectif volontairement large : le plafond de capacité (base/NEW_ITEM_LOAD) ne doit pas
  // masquer les paliers du frein qu'on teste ici.
  const goal = base * NEW_ITEM_LOAD;

  it("plein régime quand tout va bien", () => {
    expect(effectiveNewPerDay(base, 0.9, 5, goal)).toBe(base);
    expect(effectiveNewPerDay(base, null, 0, goal)).toBe(base);
  });

  it("le réglage est un plafond SOUHAITÉ : la capacité de l'objectif a le dernier mot", () => {
    // C'est le cœur du problème corrigé : 10 mots neufs par jour sur un objectif de 10
    // cartes faisaient croître le retard sans fin. L'objectif n'en absorbe que deux.
    expect(effectiveNewPerDay(10, null, 0, 10)).toBe(2);
    expect(effectiveNewPerDay(10, null, 0, 20)).toBe(4);
    // Un réglage sous la capacité, lui, est respecté tel quel.
    expect(effectiveNewPerDay(1, null, 0, 50)).toBe(1);
  });

  it("réduit à 75 % au-delà d'un jour d'objectif de retard", () => {
    expect(effectiveNewPerDay(base, 0.9, goal * BACKLOG_SLOW_DAYS + 1, goal)).toBe(
      Math.floor(base * 0.75),
    );
  });

  it("réduit de moitié quand l'utilisateur peine OU accumule deux jours", () => {
    expect(effectiveNewPerDay(base, 0.7, 0, goal)).toBe(Math.floor(base / 2)); // struggling
    expect(effectiveNewPerDay(base, 0.95, goal * BACKLOG_HALF_DAYS + 1, goal)).toBe(
      Math.floor(base / 2),
    );
  });

  it("coupe les nouveautés au-delà de trois jours d'objectif de retard", () => {
    expect(effectiveNewPerDay(base, 0.95, goal * BACKLOG_STOP_DAYS + 1, goal)).toBe(0);
    // ... ou plus tôt si l'utilisateur peine en plus d'accumuler.
    expect(effectiveNewPerDay(base, 0.6, goal * BACKLOG_HALF_DAYS + 1, goal)).toBe(0);
  });

  it("les seuils suivent l'OBJECTIF, pas une valeur absolue", () => {
    // 25 cartes dues : deux jours et demi de retard à objectif 10 (on divise), à peine plus
    // d'un demi-jour à objectif 40 (plein régime). L'ancien seuil absolu (sessionCap = 30)
    // traitait les deux de la même façon.
    expect(effectiveNewPerDay(base, 0.95, 25, 10)).toBe(1);
    expect(effectiveNewPerDay(base, 0.95, 25, 40)).toBe(sustainableNewPerDay(40));
  });

  it("ralentir n'est pas couper : un plancher d'un mot avant le palier de coupure", () => {
    expect(effectiveNewPerDay(10, 0.7, 0, 10)).toBe(1);
  });
});
