import { describe, expect, it } from "vitest";
import { getCurriculum, lessonNeighbors } from "./curriculum";

describe("lessonNeighbors", () => {
  const all = getCurriculum();

  it("renvoie les ids adjacents dans l'ordre du curriculum pour une leçon du milieu", () => {
    const mid = Math.floor(all.length / 2);
    const { prevId, nextId } = lessonNeighbors(all[mid].id);
    expect(prevId).toBe(all[mid - 1].id);
    expect(nextId).toBe(all[mid + 1].id);
  });

  it("pas de précédent pour la première leçon", () => {
    const { prevId, nextId } = lessonNeighbors(all[0].id);
    expect(prevId).toBeUndefined();
    expect(nextId).toBe(all[1].id);
  });

  it("pas de suivant pour la dernière leçon", () => {
    const last = all.length - 1;
    const { prevId, nextId } = lessonNeighbors(all[last].id);
    expect(nextId).toBeUndefined();
    expect(prevId).toBe(all[last - 1].id);
  });

  it("renvoie un objet vide pour un id inconnu", () => {
    expect(lessonNeighbors("id-inexistant")).toEqual({});
  });
});
