import { describe, expect, it } from "vitest";
import { isSelfRadical, kanjiParts, partsSummary } from "./kanjiParts";

// Tests sur la donnée COMMITTÉE (kanji-parts.json), comme kanjiInfo.test.ts : ils valident
// autant le corpus que le code qui le lit.
describe("kanjiParts — composition d'un kanji", () => {
  it("décompose 見 en œil + jambes", () => {
    expect(kanjiParts("見").map((p) => p.ja)).toEqual(["目", "儿"]);
    expect(kanjiParts("見")[0].fr).toBe("œil");
  });

  it("glose une variante par sa forme de base (亻 → 人)", () => {
    const [radical, tree] = kanjiParts("休");
    expect(radical.ja).toBe("亻");
    expect(radical.fr).toBe("personne");
    expect(radical.radical).toBe(true);
    expect(tree.ja).toBe("木");
  });

  it("marque le composant qui donne la lecture (語 : 吾)", () => {
    const phon = kanjiParts("語").find((p) => p.phonetic);
    expect(phon?.ja).toBe("吾");
    expect(kanjiParts("語").find((p) => p.radical)?.ja).toBe("言");
  });

  it("n'annonce qu'UN radical, même quand les systèmes de classement se contredisent", () => {
    // 聞 : 門 chez Nelson, 耳 dans le classement traditionnel — la fiche n'en montre qu'un.
    expect(kanjiParts("聞").filter((p) => p.radical)).toHaveLength(1);
    expect(kanjiParts("思").filter((p) => p.radical)).toHaveLength(1);
  });

  it("ne rend rien quand la composition n'est pas connue ou serait incomplète", () => {
    expect(kanjiParts("日")).toEqual([]);
    // 電 : le premier niveau de KanjiVG donnerait « 雨 + 日 » en oubliant le 乚.
    expect(kanjiParts("電")).toEqual([]);
    expect(kanjiParts("x")).toEqual([]);
  });

  it("signale les kanji qui sont eux-mêmes des radicaux", () => {
    // 見 porte la marque de radical sur le caractère entier : aucune de ses parties ne l'a.
    expect(isSelfRadical("見")).toBe(true);
    expect(kanjiParts("見").some((p) => p.radical)).toBe(false);
    expect(isSelfRadical("休")).toBe(false);
  });

  it("résume la composition en une ligne, glyphe seul pour un composant non glosé", () => {
    // 儿 n'est pas un kanji de l'inventaire : sa glose vient du corpus généré
    // (kanji-parts-fr.json). Tant qu'elle manque, on montre le glyphe — pas d'invention.
    expect(partsSummary("見")).toBe("目 œil + 儿");
    expect(partsSummary("日")).toBe("");
  });
});
