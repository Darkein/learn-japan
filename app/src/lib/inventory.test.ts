import { describe, expect, it } from "vitest";
import { canonicalVocabId, resolveVocab } from "./inventory";

// Ces tests s'appuient sur les entrées réelles de app/src/data/inventory/vocab.json
// qui regroupent plusieurs formes sous une clé composée (séparateur « ; »).
describe("canonicalVocabId — formes composées de l'inventaire", () => {
  it("mappe la forme propre du tokenizer vers l'id canonique composé", () => {
    // いい; よい|いい; よい → le token « いい » produit l'id いい|いい
    expect(canonicalVocabId("いい|いい")).toBe("いい; よい|いい; よい");
    // 足; 脚|あし → le kanji 足 (lecture あし) doit résoudre
    expect(canonicalVocabId("足|あし")).toBe("足; 脚|あし");
    // clé composée côté lecture uniquement : 何|なん; なに
    expect(canonicalVocabId("何|なに")).toBe("何|なん; なに");
    expect(canonicalVocabId("何|なん")).toBe("何|なん; なに");
  });

  it("laisse un id déjà canonique inchangé", () => {
    expect(canonicalVocabId("いい; よい|いい; よい")).toBe("いい; よい|いい; よい");
  });

  it("renvoie un id inconnu tel quel", () => {
    expect(canonicalVocabId("存在しない|そんざいしない")).toBe("存在しない|そんざいしない");
  });
});

describe("resolveVocab — résolution via alias composé", () => {
  it("retrouve la définition curée d'un mot stocké en forme composée", () => {
    expect(resolveVocab("いい|いい").fr).toBe("bon, bien");
    expect(resolveVocab("足|あし").fr).toBe("pied, jambe");
  });
});
