import { describe, expect, it } from "vitest";
import kanjiInv from "../data/inventory/kanji.json";
import kanjiFrOverlay from "../data/inventory/kanji-fr.json";
import vocabInv from "../data/inventory/vocab.json";
import vocabFrOverlay from "../data/inventory/vocab-fr.json";
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

/**
 * Un exercice peut partir du sens FR et demander le mot (« Tape le mot en japonais »,
 * QCM depuis la face française). La question n'a de réponse que si le gloss désigne UN
 * mot : « oui » qui vaut はい ET ええ est insoluble sans contexte — or la carte n'en donne
 * aucun. Les glosses du référentiel portent donc leur propre désambiguïsation (registre,
 * nature, graphie, domaine) ; ce test interdit d'en réintroduire un partagé.
 */
describe("glosses FR du référentiel — un sens, un mot", () => {
  it("aucun gloss de vocabulaire n'est porté par deux mots distincts", () => {
    const byGloss = new Map<string, Set<string>>();
    for (const id of [...Object.keys(vocabFrOverlay), ...vocabInv.map((v) => v.id)]) {
      const fr = resolveVocab(id).fr;
      if (!fr) continue;
      // Les clés d'overlay redondantes (« 行く|いく » pour « 行く|いく; ゆく ») désignent le
      // même mot : on regroupe sur l'id canonique, pas sur l'id d'origine.
      (byGloss.get(fr) ?? byGloss.set(fr, new Set()).get(fr)!).add(canonicalVocabId(id));
    }
    const shared = [...byGloss].filter(([, ids]) => ids.size > 1);
    expect(shared.map(([fr, ids]) => `${fr} → ${[...ids].join(" / ")}`)).toEqual([]);
  });

  it("aucun gloss de kanji n'est porté par deux caractères", () => {
    const byGloss = new Map<string, string[]>();
    const overlay = kanjiFrOverlay as Record<string, string | undefined>;
    for (const k of kanjiInv) {
      const fr = k.fr ?? overlay[k.id];
      if (!fr) continue;
      byGloss.set(fr, [...(byGloss.get(fr) ?? []), k.id]);
    }
    const shared = [...byGloss].filter(([, ids]) => ids.length > 1);
    expect(shared.map(([fr, ids]) => `${fr} → ${ids.join(" / ")}`)).toEqual([]);
  });
});
