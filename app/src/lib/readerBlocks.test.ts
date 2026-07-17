import { describe, expect, it } from "vitest";
import { groupTokensByParagraphs } from "./readerBlocks";

function tok(surface: string) {
  return { surface };
}

describe("groupTokensByParagraphs", () => {
  it("répartit les tokens sur deux paragraphes selon la longueur cumulée", () => {
    // "猫が" + "\n" + "水を飲む" (7 caractères, séparateur au 3e)
    const tokens = [tok("猫"), tok("が"), tok("水"), tok("を"), tok("飲む")];
    const blocks = groupTokensByParagraphs(
      [
        { type: "para", text: "猫が" },
        { type: "para", text: "水を飲む" },
      ],
      tokens,
    );
    expect(blocks).toEqual([
      { type: "para", tokenIndices: [0, 1] },
      { type: "para", tokenIndices: [2, 3, 4] },
    ]);
  });

  it("distingue un titre d'un paragraphe", () => {
    const tokens = [tok("猫"), tok("の"), tok("ニュース"), tok("猫"), tok("が"), tok("いる")];
    const blocks = groupTokensByParagraphs(
      [
        { type: "heading", text: "猫のニュース" },
        { type: "para", text: "猫がいる" },
      ],
      tokens,
    );
    expect(blocks?.[0].type).toBe("heading");
    expect(blocks?.[0].tokenIndices).toEqual([0, 1, 2]);
    expect(blocks?.[1].type).toBe("para");
    expect(blocks?.[1].tokenIndices).toEqual([3, 4, 5]);
  });

  it("retourne null sans paragraphes (histoire générée classique)", () => {
    expect(groupTokensByParagraphs(undefined, [tok("猫")])).toBeNull();
    expect(groupTokensByParagraphs([], [tok("猫")])).toBeNull();
  });

  it("retourne null sans tokens", () => {
    expect(groupTokensByParagraphs([{ type: "para", text: "猫" }], [])).toBeNull();
  });

  it("rattache un léger décalage de longueur au paragraphe courant sans perdre de tokens", () => {
    // Un token fusionné (annotateTokens) fait que la somme des surfaces dépasse legèrement
    // la longueur déclarée du 1er paragraphe : le token « déborde » reste dans le 1er bloc.
    const tokens = [tok("猫が"), tok("水"), tok("を"), tok("飲む")];
    const blocks = groupTokensByParagraphs(
      [
        { type: "para", text: "猫が" }, // longueur 2, mais le 1er token fait déjà 2 → ok
        { type: "para", text: "水を飲む" },
      ],
      tokens,
    );
    const total = blocks!.flatMap((b) => b.tokenIndices).length;
    expect(total).toBe(tokens.length);
  });
});
