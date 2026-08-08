import { describe, expect, it } from "vitest";
import { allVocabInv } from "./inventory";
import { glossKey, sameMeaning } from "./synonyms";

describe("glossKey", () => {
  it("ignore la casse, l'espacement et l'ordre des sens", () => {
    expect(glossKey("mais, cependant")).toBe(glossKey("Cependant,  mais"));
    expect(glossKey("billet, ticket")).toBe(glossKey("ticket ; billet"));
  });

  it("garde les qualificatifs : c'est eux qui séparent deux mots proches", () => {
    expect(glossKey("chaud (climat)")).not.toBe(glossKey("chaud (au toucher)"));
    expect(glossKey("chaud (climat)")).not.toBe(glossKey("chaud"));
  });

  it("ne confond pas deux mots que seul un accent sépare", () => {
    expect(glossKey("sucré")).not.toBe(glossKey("sucre"));
  });
});

describe("sameMeaning", () => {
  it("vrai pour deux libellés du même sens, faux sinon", () => {
    expect(sameMeaning("mais, cependant", "cependant, mais")).toBe(true);
    expect(sameMeaning("chaud (climat)", "chaud (au toucher)")).toBe(false);
  });

  it("faux pour un sens absent ou non renseigné (le tiret de l'UI)", () => {
    expect(sameMeaning("—", "—")).toBe(false);
    expect(sameMeaning(undefined, "chat")).toBe(false);
    expect(sameMeaning("", "")).toBe(false);
  });
});

describe("référentiel — gloses discriminantes", () => {
  // L'invariant qui rend les exercices « sens FR → mot japonais » répondables : une glose
  // partagée par deux mots pose une question sans réponse unique et compte fausse une
  // réponse juste sur deux (暑い et 暖かい tous deux « chaud (climat) »). La glose doit
  // porter ce qui distingue les mots — registre, domaine, lecture, nature. Toute entrée
  // ajoutée au référentiel doit respecter ça : ce test échoue sinon.
  it("aucun sens FR n'est partagé par deux mots, même à l'ordre des sens près", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const v of allVocabInv()) {
      if (!v.fr || v.fr === "—") continue;
      const key = glossKey(v.fr);
      const first = seen.get(key);
      if (first) clashes.push(`${first} / ${v.id} → « ${v.fr} »`);
      else seen.set(key, v.id);
    }
    expect(clashes).toEqual([]);
  });
});
