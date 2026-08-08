import { describe, expect, it } from "vitest";
import { allVocabInv } from "./inventory";
import { alternateAnswers, glossKey, sameMeaning, synonymEntries } from "./synonyms";

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

describe("alternateAnswers", () => {
  it("accepte le synonyme quand deux mots portent le même sens", () => {
    // しかし « cependant, mais » et でも « mais, cependant » : la face avant ne désigne
    // pas un mot unique, taper l'un ou l'autre est juste.
    const alt = alternateAnswers("しかし|しかし", "cependant, mais");
    expect(alt).toContain("でも");
    expect(alt).not.toContain("しかし"); // jamais le mot lui-même
  });

  it("vide quand le sens est propre à un seul mot", () => {
    expect(alternateAnswers("暑い|あつい", "chaud (climat)")).toEqual([]);
    expect(alternateAnswers("猫|ねこ", "chat")).toEqual([]);
  });

  it("vide sans sens exploitable", () => {
    expect(alternateAnswers("猫|ねこ", "—")).toEqual([]);
    expect(alternateAnswers("猫|ねこ", undefined)).toEqual([]);
  });

  it("propose graphie ET lecture du synonyme", () => {
    // 切符（きっぷ）et 券（けん）« billet, ticket ».
    const alt = alternateAnswers("切符|きっぷ", "billet, ticket");
    expect(alt).toContain("券");
    expect(alt).toContain("けん");
  });
});

describe("synonymEntries", () => {
  it("regroupe les entrées d'un même sens, l'entrée d'origine comprise", () => {
    const ids = synonymEntries("mais, cependant").map((e) => e.id);
    expect(ids).toContain("でも|でも");
    expect(ids).toContain("しかし|しかし");
  });
});

describe("référentiel", () => {
  // Garde-fou de données : deux mots qui portent EXACTEMENT la même glose posent une
  // question sans réponse unique (« chaud (climat) » pour 暑い ET 暖かい). Le filet de
  // sécurité de synonyms.ts les rattrape, mais la glose doit d'abord les distinguer
  // quand ils se distinguent — on borne donc le nombre de groupes restants.
  it("ne laisse aucune glose FR strictement partagée par deux mots", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const v of allVocabInv()) {
      if (!v.fr || v.fr === "—") continue;
      const first = seen.get(v.fr);
      if (first) clashes.push(`${first} / ${v.id} → « ${v.fr} »`);
      else seen.set(v.fr, v.id);
    }
    expect(clashes).toEqual([]);
  });
});
