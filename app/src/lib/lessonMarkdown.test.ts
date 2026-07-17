import { describe, expect, it } from "vitest";
import { blockText, findBlockForSegment, normalizeForMatch, parseBlocks, type Block } from "./lessonMarkdown";

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);
const callout = (blocks: Block[], ctype: string) =>
  blocks.find((b): b is Extract<Block, { kind: "callout" }> => b.kind === "callout" && b.ctype === ctype);

describe("parseBlocks — encadrés :::", () => {
  it("parse un piège puis un résumé, chacun refermé", () => {
    const md = [
      ":::pitfall",
      "読むです",
      "です ne suit pas un verbe.",
      ":::",
      "# Conclusion",
      "En résumé :",
      ":::summary",
      "- Point A",
      "- Point B",
      ":::",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(kinds(blocks)).toEqual(["callout", "heading", "para", "callout"]);
    expect(callout(blocks, "pitfall")?.body).toContain("読むです");
    expect(callout(blocks, "pitfall")?.body).not.toContain("Conclusion");
    expect(callout(blocks, "summary")?.body).toContain("Point A");
  });

  // Régression leçon 05 : le modèle a oublié le `:::` de fermeture du piège. Sans borne,
  // le piège avalait « # Conclusion » ET le `:::summary` complet, rendus À L'INTÉRIEUR de
  // l'encadré. Un bloc non refermé doit s'arrêter au prochain marqueur structurel.
  it("borne un :::pitfall NON refermé au titre suivant, sans avaler la conclusion ni le résumé", () => {
    const md = [
      ":::pitfall",
      "読むです",
      "です ne peut pas être utilisé après un verbe.",
      "# Conclusion",
      "En résumé, voici les points clés :",
      ":::summary",
      "- La copule です relie un nom.",
      "- です ne suit pas un verbe.",
      ":::",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(kinds(blocks)).toEqual(["callout", "heading", "para", "callout"]);

    const pit = callout(blocks, "pitfall");
    expect(pit?.body).toContain("読むです");
    expect(pit?.body).not.toContain("Conclusion");
    expect(pit?.body).not.toContain("copule");

    const sum = callout(blocks, "summary");
    expect(sum?.body).toContain("La copule です relie un nom.");

    const heading = blocks.find((b) => b.kind === "heading");
    expect(heading && "text" in heading && heading.text).toBe("Conclusion");
  });

  it("borne un bloc non refermé au prochain ouvreur :::", () => {
    const md = [
      ":::info",
      "Une note.",
      ":::warning",
      "Une mise en garde.",
      ":::",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(kinds(blocks)).toEqual(["callout", "callout"]);
    expect(callout(blocks, "info")?.body).toContain("Une note.");
    expect(callout(blocks, "info")?.body).not.toContain("mise en garde");
    expect(callout(blocks, "warning")?.body).toContain("Une mise en garde.");
  });

  // Régression : dans un :::pitfall, le modèle réutilise la convention « phrase JP puis
  // > glose » des :::example. La ligne `>` doit devenir un bloc quote (glose formatée),
  // pas du texte brut avec le chevron.
  it("ligne > hors :::example → bloc quote sans le chevron", () => {
    const md = [
      ":::pitfall",
      "私は英語を勉強",
      "> Erreur : oubli de する",
      ":::",
    ].join("\n");
    const blocks = parseBlocks(md);
    const pit = callout(blocks, "pitfall");
    expect(pit?.body).toContain("> Erreur : oubli de する");

    const inner = parseBlocks(pit!.body);
    expect(kinds(inner)).toEqual(["para", "quote"]);
    const quote = inner.find((b) => b.kind === "quote");
    expect(quote && "lines" in quote && quote.lines).toEqual(["Erreur : oubli de する"]);
  });

  // Le modèle écrit parfois `::` ou `::::` au lieu de `:::` : ces lignes doivent fermer
  // le bloc (et jamais apparaître comme texte).
  it("fermeture mal comptée (:: ou ::::) : ferme le bloc sans fuiter dans le rendu", () => {
    const md = [
      ":::example",
      "猫がいます。",
      "> Il y a un chat.",
      "::",
      "Texte après.",
      ":::summary",
      "- Point A",
      "::::",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(kinds(blocks)).toEqual(["example", "para", "callout"]);
    const para = blocks.find((b) => b.kind === "para");
    expect(para && "lines" in para && para.lines).toEqual(["Texte après."]);
  });

  it("un :::example non refermé en fin de texte reste borné à son contenu", () => {
    const md = [
      "Texte d'intro.",
      ":::example",
      "猫がいます。",
      "> Il y a un chat.",
      "",
      "# Après",
      "La suite.",
    ].join("\n");
    const blocks = parseBlocks(md);
    expect(kinds(blocks)).toEqual(["para", "example", "heading", "para"]);
    const ex = blocks.find((b) => b.kind === "example");
    expect(ex && "pairs" in ex && ex.pairs).toEqual([{ jp: "猫がいます。", fr: "Il y a un chat." }]);
  });
});

describe("normalizeForMatch", () => {
  it("ne garde que lettres/chiffres/kana/kanji, en minuscules", () => {
    expect(normalizeForMatch("La particule **は** marque le thème.")).toBe("laparticuleはmarquelethème");
  });

  it("retire le furigana entre parenthèses", () => {
    expect(normalizeForMatch("弁護士（べんごし）です。")).toBe("弁護士です");
  });
});

describe("blockText", () => {
  it("concatène le texte humain des blocs structurés", () => {
    const blocks = parseBlocks(
      "## Titre\n\nUn paragraphe.\n\n| Forme | Exemple |\n|---|---|\n| Présent | 今 |\n\n:::example\n猫です。\n> C'est un chat.\n:::",
    );
    expect(blocks.map(blockText)).toEqual([
      "Titre",
      "Un paragraphe.",
      "Forme Exemple Présent 今",
      "猫です。 C'est un chat.",
    ]);
  });
});

describe("findBlockForSegment", () => {
  const blocks = parseBlocks(
    [
      "## La particule は",
      "",
      "La particule **は** marque le thème. Elle suit le nom.",
      "",
      ":::example",
      "私（わたし）は学生です。",
      "> Je suis étudiant.",
      ":::",
      "",
      "## Résumé",
      "",
      "Elle suit le nom.",
    ].join("\n"),
  );

  it("retrouve le paragraphe contenant la phrase parlée (Markdown/furigana ignorés)", () => {
    // Le segment parlé a traversé stripMarkdown : plus de ** ni de furigana.
    expect(findBlockForSegment(blocks, "La particule は marque le thème.", "La particule は")).toBe(1);
    expect(findBlockForSegment(blocks, "私は学生です。", undefined)).toBe(2);
  });

  it("biais fromIndex : une phrase présente deux fois matche à partir du dernier bloc trouvé", () => {
    expect(findBlockForSegment(blocks, "Elle suit le nom.", undefined, 0)).toBe(1);
    expect(findBlockForSegment(blocks, "Elle suit le nom.", undefined, 3)).toBe(4);
  });

  it("fragment trop court → repli sur le titre correspondant au label", () => {
    expect(findBlockForSegment(blocks, "は", "Résumé")).toBe(3);
  });

  it("-1 quand rien ne correspond", () => {
    expect(findBlockForSegment(blocks, "Texte absent du cours entier.", "Inconnu")).toBe(-1);
    expect(findBlockForSegment([], "peu importe le texte ici", "x")).toBe(-1);
  });
});
