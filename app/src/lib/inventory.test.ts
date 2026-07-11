import { describe, expect, it } from "vitest";
import { canonicalVocabId, kanaGlossOverlay, resolveVocab } from "./inventory";

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

describe("kanaGlossOverlay — glosses curés par lecture kana", () => {
  it("attribue les lectures ambiguës au mot du curriculum (N5 d'abord)", () => {
    const o = kanaGlossOverlay();
    // いる : 居る (N5) doit gagner sur 要る et sur tout homophone JMdict (射る…)
    expect(o["いる"]).toBe("être, se trouver (être animé)");
    // ない : la négation, jamais 亡い « décédé »
    expect(o["ない"]).toBe("ne pas être, ne pas avoir");
    expect(o["きく"]).toBe("écouter, entendre");
    expect(o["かく"]).toBe("écrire");
    expect(o["ねこ"]).toBe("chat");
  });

  it("ignore les lectures annotées (non purement kana)", () => {
    const o = kanaGlossOverlay();
    // « ～円|～えん » et « 十|(〜を) とお » ne produisent pas de clé
    for (const k of Object.keys(o)) {
      expect(k).toMatch(/^[ぁ-ヿ〜]+$/);
    }
  });
});

describe("resolveVocab — résolution via alias composé", () => {
  it("retrouve la définition curée d'un mot stocké en forme composée", () => {
    expect(resolveVocab("いい|いい").fr).toBe("bon, bien");
    expect(resolveVocab("足|あし").fr).toBe("pied, jambe");
  });
});
