import { describe, expect, it } from "vitest";
import { parseBlocks, type Block } from "./lessonMarkdown";

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
