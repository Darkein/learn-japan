import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMeta, getVocab, putDictCache, putMeta, putVocab } from "./db";

const REV = "jmdict-fr-v3+gloss-v1";
const CORRECT = "doux, chaud (l'air, une pièce, un vêtement)";

// Les sens re-dérivés viennent de l'inventaire curé : on n'en simule que les entrées utiles.
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  kanaGlossOverlay: () => ({}),
  resolveVocab: (id: string) => ({
    ja: id.split("|")[0],
    fr: id.startsWith("暖かい") ? CORRECT : "",
  }),
}));

function item(id: string, meaning: string) {
  const [surface, reading] = id.split("|");
  return { id, surface, reading, meaning, tags: [], status: "review" as const, cards: {} };
}

/**
 * Le sens d'un mot est FIGÉ sur l'item à sa création : corriger un gloss curé ne suffit
 * pas, il faut re-dériver ce qui est déjà en base — sinon l'apprenant continue de réviser
 * « chaud (climat) » pour un mot qui n'a rien de climatique. Le cache du JMdict ne signale
 * pas ce changement (l'asset n'a pas bougé) : c'est `MEANINGS_REV` qui le porte.
 */
describe("loadContentDict — propagation des glosses curés corrigés", () => {
  beforeEach(() => vi.resetModules());

  it("re-dérive les sens figés d'un client dont le cache du dico est déjà à jour", async () => {
    await putDictCache("jmdict-fr-v3", {});
    await putVocab(item("暖かい|あたたかい", "chaud (climat)"));

    const { loadContentDict } = await import("./data");
    await loadContentDict();

    await vi.waitFor(async () =>
      expect((await getVocab("暖かい|あたたかい"))?.meaning).toBe(CORRECT),
    );
    expect(await getMeta("meanings.rev")).toBe(REV);
  });

  it("ne repasse pas sur les items une fois la révision enregistrée", async () => {
    await putDictCache("jmdict-fr-v3", {});
    await putMeta("meanings.rev", REV);
    await putVocab(item("暖かい2|あたたかい2", "sens laissé tel quel"));

    const { loadContentDict } = await import("./data");
    await loadContentDict();
    await new Promise((r) => setTimeout(r, 30));

    expect((await getVocab("暖かい2|あたたかい2"))?.meaning).toBe("sens laissé tel quel");
  });
});
