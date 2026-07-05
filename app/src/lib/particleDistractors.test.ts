import { describe, expect, it } from "vitest";
import { PARTICLE_POOL, particleDistractors } from "./particleDistractors";

describe("particleDistractors", () => {
  it("renvoie n distracteurs distincts, jamais la réponse", () => {
    for (const p of PARTICLE_POOL) {
      const d = particleDistractors(p);
      expect(d).toHaveLength(3);
      expect(d).not.toContain(p);
      expect(new Set(d).size).toBe(3);
    }
  });

  it("tire dans l'ensemble de confusion (même slot grammatical)", () => {
    expect(particleDistractors("は")).toEqual(["も", "が", "で"]);
    expect(particleDistractors("に")).toEqual(["で", "へ", "まで"]);
  });

  it("complète depuis le pool pour une particule hors ensembles", () => {
    const d = particleDistractors("や");
    expect(d).toHaveLength(3);
    expect(d).not.toContain("や");
    for (const p of d) expect(PARTICLE_POOL).toContain(p);
  });
});
