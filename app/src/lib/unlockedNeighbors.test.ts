import { describe, expect, it } from "vitest";
import { unlockedNeighbors } from "./lessons";

// Séquence minimale : seul `id` et `locked` sont utilisés par la fonction.
const seq = (spec: [string, boolean][]) => spec.map(([id, locked]) => ({ id, locked }));

describe("unlockedNeighbors", () => {
  it("ne parcourt que les leçons débloquées (saute les verrouillées en queue)", () => {
    const lessons = seq([
      ["l1", false],
      ["l2", false],
      ["l3", true],
      ["l4", true],
    ]);
    expect(unlockedNeighbors(lessons, "l1")).toEqual({ nextId: "l2" });
    expect(unlockedNeighbors(lessons, "l2")).toEqual({ prevId: "l1" }); // pas de next : l3 verrouillée
  });

  it("saute une leçon verrouillée intercalée entre deux débloquées", () => {
    const lessons = seq([
      ["l1", false],
      ["l2", true], // verrouillée mais entourée de débloquées (ex. leçon ultérieure démarrée)
      ["l3", false],
    ]);
    expect(unlockedNeighbors(lessons, "l1")).toEqual({ nextId: "l3" });
    expect(unlockedNeighbors(lessons, "l3")).toEqual({ prevId: "l1" });
  });

  it("renvoie les deux voisins pour une leçon débloquée du milieu", () => {
    const lessons = seq([
      ["l1", false],
      ["l2", false],
      ["l3", false],
    ]);
    expect(unlockedNeighbors(lessons, "l2")).toEqual({ prevId: "l1", nextId: "l3" });
  });

  it("objet vide si la leçon courante est verrouillée ou inconnue", () => {
    const lessons = seq([
      ["l1", false],
      ["l2", true],
    ]);
    expect(unlockedNeighbors(lessons, "l2")).toEqual({});
    expect(unlockedNeighbors(lessons, "inexistante")).toEqual({});
  });
});
