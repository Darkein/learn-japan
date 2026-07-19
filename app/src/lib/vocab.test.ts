import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { getVocab, putVocab, type VocabItem } from "./db";
import {
  addInventoryWordToReview,
  applyStatus,
  effectiveExample,
  isContent,
  itemIdFor,
  meaningFor,
  refreshStoredMeanings,
  repairConjugatedVocab,
} from "./vocab";
import type { KuromojiToken } from "./tokenizer";

vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: (id: string) =>
    id === "猫|ねこ" ? { ja: "猫は水を飲みます。", fr: "Le chat boit de l'eau." } : null,
}));

// Lectures de formes de base connues du mock ; toute autre forme simule un dico kuromoji
// indisponible (échec de retokenisation).
vi.mock("./tokenizer", () => ({
  tokenize: async (text: string) => {
    const READINGS: Record<string, string> = { する: "スル", いる: "イル", 食べる: "タベル" };
    if (!READINGS[text]) throw new Error("dico indisponible (test)");
    return [{ surface_form: text, reading: READINGS[text] }];
  },
}));

function tok(p: Partial<KuromojiToken> & { surface_form: string; pos: string }): KuromojiToken {
  return {
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: p.surface_form,
    ...p,
  };
}

describe("isContent", () => {
  it("retient un mot de contenu japonais", () => {
    const neko = tok({ surface_form: "猫", pos: "名詞", pos_detail_1: "一般", basic_form: "猫", reading: "ネコ" });
    expect(isContent(neko)).toBe(true);
  });

  it("écarte un mot latin étiqueté 名詞 固有名詞 par kuromoji", () => {
    // Kuromoji classe les mots inconnus en écriture latine en 名詞/固有名詞, sans forme de base.
    const english = tok({ surface_form: "English", pos: "名詞", pos_detail_1: "固有名詞", basic_form: "*" });
    expect(isContent(english)).toBe(false);
  });

  it("écarte un nombre en chiffres arabes (名詞 数)", () => {
    const num = tok({ surface_form: "123", pos: "名詞", pos_detail_1: "数", basic_form: "*" });
    expect(isContent(num)).toBe(false);
  });
});

describe("itemIdFor", () => {
  it("distingue deux mots inconnus sans forme de base (pas de fusion sur « *| »)", () => {
    // Sans forme de base, itemIdFor doit retomber sur la surface : sinon « GitHub » et
    // « JavaScript » partageaient l'id « *| » et donc le même compteur de vues.
    const gh = tok({ surface_form: "コンピュータ", pos: "名詞", basic_form: "*", reading: "コンピュータ" });
    const js = tok({ surface_form: "プログラム", pos: "名詞", basic_form: "*", reading: "プログラム" });
    expect(itemIdFor(gh)).not.toBe(itemIdFor(js));
    expect(itemIdFor(gh)).toBe("コンピュータ|こんぴゅーた");
  });
});

describe("vocab ↔ SRS (IndexedDB)", () => {
  it("persiste un item et planifie la compétence écrite", async () => {
    const neko = tok({ surface_form: "猫", pos: "名詞", basic_form: "猫", reading: "ネコ" });
    const id = itemIdFor(neko);

    const item = await applyStatus(neko, "review", new Date("2026-06-23T08:00:00Z"));
    expect(item.status).toBe("review");
    expect(item.cards.written).toBeDefined();

    const reloaded = await getVocab(id);
    expect(reloaded?.id).toBe(id);
    expect(reloaded?.status).toBe("review");
    expect(reloaded?.cards.written?.due).toBeInstanceOf(Date);
  });

  it("« Je connais » marque l'item comme connu", async () => {
    const inu = tok({ surface_form: "犬", pos: "名詞", basic_form: "犬", reading: "イヌ" });
    const item = await applyStatus(inu, "known");
    expect(item.status).toBe("known");
    expect((await getVocab(itemIdFor(inu)))?.status).toBe("known");
  });
});

describe("addInventoryWordToReview", () => {
  const inv = { id: "毎日|まいにち", ja: "毎日", yomi: "まいにち", fr: "tous les jours", level: 5 };

  it("crée l'item en « à revoir » avec la carte écrite planifiée et journalise", async () => {
    const item = await addInventoryWordToReview(inv, new Date("2026-06-23T08:00:00Z"));
    expect(item.status).toBe("review");
    expect(item.cards.written?.due).toBeInstanceOf(Date);

    const reloaded = await getVocab(inv.id);
    expect(reloaded?.surface).toBe("毎日");
    expect(reloaded?.reading).toBe("まいにち");
    expect(reloaded?.meaning).toBe("tous les jours");
    expect(reloaded?.status).toBe("review");
  });

  it("n'écrase pas un item déjà en base", async () => {
    const existing = tok({ surface_form: "水", pos: "名詞", basic_form: "水", reading: "ミズ" });
    await applyStatus(existing, "known");
    const id = itemIdFor(existing);

    const item = await addInventoryWordToReview({ id, ja: "水", yomi: "みず", fr: "eau", level: 5 });
    expect(item.status).toBe("known");
    expect((await getVocab(id))?.status).toBe("known");
  });
});

describe("forme de dictionnaire (création + réparation)", () => {
  it("stocke la forme de base pour un token conjugué (し → する)", async () => {
    const shi = tok({ surface_form: "し", pos: "動詞", basic_form: "する", reading: "シ" });
    const item = await applyStatus(shi, "review");
    expect(item.id).toBe("する|し");
    expect(item.surface).toBe("する");
    expect(item.reading).toBe("する");
  });

  it("retombe sur la forme rencontrée si la retokenisation échoue", async () => {
    const yon = tok({ surface_form: "読ん", pos: "動詞", basic_form: "読む", reading: "ヨン" });
    const item = await applyStatus(yon, "review");
    expect(item.surface).toBe("読ん");
    expect(item.reading).toBe("よん");
  });

  it("répare un item existant stocké en forme conjuguée", async () => {
    await putVocab({
      id: "食べる|たべ", surface: "食べ", reading: "たべ", meaning: "manger",
      tags: [], status: "review", cards: {},
    });
    expect(await repairConjugatedVocab()).toBeGreaterThanOrEqual(1);
    const v = await getVocab("食べる|たべ");
    expect(v?.surface).toBe("食べる");
    expect(v?.reading).toBe("たべる");
  });

  it("laisse intact un item irréparable (dico indisponible)", async () => {
    await repairConjugatedVocab();
    const v = await getVocab("読む|よん");
    expect(v?.surface).toBe("読ん");
  });
});

describe("meaningFor", () => {
  // JMdict-FR n'est pas chargé en test (snapshot vide) : on valide le repli inventaire,
  // qui résout aussi les mots stockés en forme composée (« いい; よい »).
  it("retombe sur l'inventaire pour un mot en forme composée", () => {
    const ii = tok({ surface_form: "いい", pos: "形容詞", basic_form: "いい", reading: "イイ" });
    expect(meaningFor(ii)).toBe("bon, bien");
  });

  it("tiret quand ni JMdict-FR ni inventaire ne connaissent le mot", () => {
    const x = tok({ surface_form: "架空語", pos: "名詞", basic_form: "架空語", reading: "カクウゴ" });
    expect(meaningFor(x)).toBe("—");
  });

  it("désambiguïse un homographe via la lecture (本|ほん → « livre », pas « origine »)", () => {
    // Le JMdict est indexé par graphie seule : 本 y donne les sens de もと (« origine »).
    // L'inventaire, indexé par graphie+lecture, doit gagner pour ほん (« livre »).
    const hon = tok({ surface_form: "本", pos: "名詞", pos_detail_1: "一般", basic_form: "本", reading: "ホン" });
    expect(meaningFor(hon)).toBe("livre");
  });
});

describe("refreshStoredMeanings", () => {
  it("re-dérive les sens figés avec un dico défectueux et compte les corrections", async () => {
    // Item créé avec l'ancien dico : いる avait hérité du gloss de 射る.
    const iru = tok({ surface_form: "い", pos: "動詞", basic_form: "いる", reading: "イ" });
    const item = await applyStatus(iru, "review");
    expect(item.meaning).not.toBe("être (êtres animés), exister"); // snapshot vide en test

    const updated = await refreshStoredMeanings({ いる: "être (êtres animés), exister" });
    expect(updated).toBeGreaterThanOrEqual(1);
    expect((await getVocab(itemIdFor(iru)))?.meaning).toBe("être (êtres animés), exister");
  });

  it("laisse intact un item dont le sens re-dérivé est identique", async () => {
    const neko2 = tok({ surface_form: "猫", pos: "名詞", basic_form: "猫", reading: "ネコ" });
    await applyStatus(neko2, "review");
    await refreshStoredMeanings({ 猫: "chat" });
    expect((await getVocab(itemIdFor(neko2)))?.meaning).toBe("chat");
  });

  it("corrige un homographe mal figé : l'inventaire prime sur le gloss JMdict par graphie", async () => {
    // Sens figé faux hérité de l'ancienne priorité JMdict-d'abord (dict["本"] = sens de もと).
    const hon = tok({ surface_form: "本", pos: "名詞", pos_detail_1: "一般", basic_form: "本", reading: "ホン" });
    const item = await applyStatus(hon, "review");
    item.meaning = "base, commencement, origine";
    await putVocab(item);
    await refreshStoredMeanings({ 本: "base, commencement, origine" });
    expect((await getVocab(itemIdFor(hon)))?.meaning).toBe("livre");
  });
});

describe("effectiveExample", () => {
  function vocab(p: Partial<VocabItem> & { id: string }): VocabItem {
    return { surface: "猫", reading: "ねこ", meaning: "chat", tags: [], status: "review", cards: {}, ...p };
  }

  it("préfère l'exemple issu d'une histoire lue", () => {
    const v = vocab({ id: "猫|ねこ", example: { ja: "猫がいます。" } });
    expect(effectiveExample(v)?.ja).toBe("猫がいます。");
  });

  it("retombe sur le corpus statique quand l'item n'a pas d'exemple", () => {
    const v = vocab({ id: "猫|ねこ" });
    expect(effectiveExample(v)).toEqual({ ja: "猫は水を飲みます。", fr: "Le chat boit de l'eau." });
  });

  it("null quand ni exemple d'histoire ni corpus", () => {
    expect(effectiveExample(vocab({ id: "犬|いぬ" }))).toBeNull();
  });
});
