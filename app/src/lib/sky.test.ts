import { describe, expect, it } from "vitest";
import { moonLit, moonLitPath, moonPhase, skyAt } from "./sky";

describe("moonPhase", () => {
  it("suit le mois synodique réel", () => {
    // Pleine lune du 7 octobre 2025, nouvelle lune du 21 octobre 2025.
    expect(moonLit(moonPhase(new Date(Date.UTC(2025, 9, 7, 3, 47))))).toBeGreaterThan(0.99);
    expect(moonLit(moonPhase(new Date(Date.UTC(2025, 9, 21, 12, 25))))).toBeLessThan(0.01);
    // Premier quartier du 29 octobre 2025 : à moitié éclairée, croissante.
    const q = moonPhase(new Date(Date.UTC(2025, 9, 29, 16, 21)));
    expect(q).toBeGreaterThan(0.23);
    expect(q).toBeLessThan(0.27);
  });

  it("dessine le croissant du côté éclairé", () => {
    // Croissant : limbe à droite (balayage 1), terminateur bombé vers la droite (0).
    expect(moonLitPath(10, 10, 5, 0.1)).toMatch(/A5\.00 5\.00 0 0 1 10\.00 15\.00 A\S+ 5\.00 0 0 0/);
    // Décroissante : limbe à gauche.
    expect(moonLitPath(10, 10, 5, 0.9)).toMatch(/A5\.00 5\.00 0 0 0 10\.00 15\.00 A\S+ 5\.00 0 0 1/);
  });
});

describe("skyAt", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m);

  it("suit l'heure : aube, jour, crépuscule, nuit", () => {
    expect(skyAt(at(5, 30), "none")).toMatchObject({ time: "dawn", sun: { alt: 0 }, mist: true, stars: false });
    const noon = skyAt(at(12), "none");
    expect(noon.time).toBe("day");
    expect(noon.sun!.alt).toBeCloseTo(1);
    expect(noon.sun!.x).toBeCloseTo(0.5);
    expect(skyAt(at(9), "none").sun!.x).toBeLessThan(0.5);
    expect(skyAt(at(15), "none")).toMatchObject({ mist: false });
    expect(skyAt(at(18), "none")).toMatchObject({ time: "dusk", sun: { alt: 0 } });
    const night = skyAt(at(23), "none");
    expect(night).toMatchObject({ time: "night", stars: true });
    expect(night.sun).toBeUndefined();
    expect(night.moon!.alt).toBeGreaterThan(0.5);
  });

  it("suit la saison", () => {
    expect(skyAt(at(12), "spring")).toMatchObject({ birds: "swallows", petals: true });
    expect(skyAt(at(12), "autumn")).toMatchObject({ birds: "geese" });
    expect(skyAt(at(12), "winter")).toMatchObject({ birds: "crane" });
    expect(skyAt(at(23), "summer")).toMatchObject({ fireflies: true });
    expect(skyAt(at(12), "summer")).toMatchObject({ fireflies: false });
    expect(skyAt(at(23), "spring").birds).toBeUndefined();
  });
});
