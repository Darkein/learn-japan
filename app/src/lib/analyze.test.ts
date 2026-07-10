import { beforeEach, describe, expect, it, vi } from "vitest";

// On stube les dépendances lourdes (tokenizer + dictionnaire) pour tester le CACHE seul :
// mêmes entrées → une seule « analyse » calculée, éviction au-delà de la borne.
const tokenizeSpy = vi.fn(async (t: string) => [{ surface: t }]);
vi.mock("./tokenizer", () => ({ tokenize: (t: string) => tokenizeSpy(t) }));
vi.mock("./data", () => ({ loadContentDict: async () => ({}) }));
vi.mock("./furigana", () => ({ annotateTokens: (toks: unknown) => toks }));
vi.mock("./gloss", () => ({ glossTokens: () => [] }));

// Import après les mocks (le module capture les dépendances à l'import).
const { analyze } = await import("./analyze");

describe("analyze (cache)", () => {
  beforeEach(() => tokenizeSpy.mockClear());

  it("mémorise : deux appels sur le même texte ne calculent qu'une fois", async () => {
    const a = analyze("同じ");
    const b = analyze("同じ");
    expect(a).toBe(b); // même promesse renvoyée
    await Promise.all([a, b]);
    expect(tokenizeSpy).toHaveBeenCalledTimes(1);
  });

  it("recalcule pour un texte différent", async () => {
    await analyze("un");
    await analyze("deux");
    // « un » vient peut-être du cache d'un test précédent ; « deux » est neuf → au moins 1 appel.
    expect(tokenizeSpy).toHaveBeenCalledWith("deux");
  });

  it("évince au-delà de la borne (12) : le plus ancien est recalculé", async () => {
    await analyze("clef-0");
    for (let i = 1; i <= 12; i++) await analyze(`clef-${i}`); // pousse « clef-0 » hors du cache
    tokenizeSpy.mockClear();
    await analyze("clef-0"); // évincé → recalcul
    expect(tokenizeSpy).toHaveBeenCalledWith("clef-0");
  });
});
