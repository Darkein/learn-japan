import { describe, expect, it } from "vitest";
import { clozeParts, hasBlank } from "./ClozeText";

describe("clozeParts", () => {
  it("isole le trou ◯◯ du mot masqué (indices impairs = trous)", () => {
    expect(clozeParts("宿題を◯◯ます。")).toEqual(["宿題を", "◯◯", "ます。"]);
  });

  it("isole le trou ＿ de la particule à replacer", () => {
    expect(clozeParts("本＿読む")).toEqual(["本", "＿", "読む"]);
  });

  it("un trou en tête laisse un segment de texte vide devant (l'alternance tient)", () => {
    expect(clozeParts("◯◯が走る。")).toEqual(["", "◯◯", "が走る。"]);
  });

  it("sans trou, le texte reste d'une pièce", () => {
    expect(clozeParts("犬が走る。")).toEqual(["犬が走る。"]);
    expect(hasBlank("犬が走る。")).toBe(false);
  });

  it("reconnaît les deux sentinelles", () => {
    expect(hasBlank("宿題を◯◯ます。")).toBe(true);
    expect(hasBlank("本＿読む")).toBe(true);
  });
});
