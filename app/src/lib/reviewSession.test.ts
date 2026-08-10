import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Card } from "ts-fsrs";
import { getVocab, putVocab, putLessonProgress, getSrsDaily, bumpSrsDaily, _resetDbForTests } from "./db";
import { newCard, State } from "./srs";
import { SRS } from "./config";
import { gradeCard, buildSession, pickOralVariant, silenceDeck } from "./reviewSession";
import { getCurriculumEntry } from "./curriculum";
import type { KuromojiToken } from "./tokenizer";

// Corpus d'exemples statique neutralisé : ces tests raisonnent sur les seuls items
// qu'ils sèment — le corpus réel (examples.json) évolue via le workflow build-examples
// et fournirait sinon des exemples inattendus (amorçage écoute, cloze).
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: () => null,
}));

// kuromoji ne tourne pas en node : chaque caractère devient un token 名詞 (suffit pour
// tester les bornes de la dictée — nombre de tuiles = longueur de la phrase).
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> =>
    [...text.replace(/[。、]/g, "")].map((ch) => ({
      surface_form: ch,
      pos: "名詞",
      pos_detail_1: "*",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "*",
      conjugated_form: "*",
      basic_form: ch,
    })),
  ),
}));

const TODAY = "2026-06-30";
const NOW = new Date(`${TODAY}T08:00:00`);

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe("échauffement SRS (existant)", () => {
  it("liste les cartes dues, puis les retire après une bonne réponse", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });

    const due = await buildSession(NOW, { scope: "due" });
    const card = due.find((c) => c.id === "水|みず");
    expect(card).toBeDefined();
    // La face avant est l'une des trois faces du mot — la direction est tirée au hasard.
    expect(["水", "みず", "eau"]).toContain(card!.front);
    expect(card!.back).toBe("水（みず）");
    expect(card!.word).toEqual({ id: "水|みず", surface: "水", reading: "みず" });

    await gradeCard(card!, "easy", NOW);
    const due2 = await buildSession(NOW, { scope: "due" });
    expect(due2.find((c) => c.id === "水|みず")).toBeUndefined();
  });

  it("vocab isolé (pas de distracteur) : saisie de la lecture, graphie acceptée aussi", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    // Seul mot en base : aucun distracteur plausible, donc pas de QCM à deux options.
    const card = (await buildSession(NOW, { scope: "due" })).find((c) => c.id === "猫|ねこ")!;
    expect(card.mode).toBe("type");
    if (card.mode !== "type") throw new Error("expected type exercise");
    expect(card.answers).toEqual(expect.arrayContaining(["猫", "ねこ"]));
  });

  it("vocab frais avec un pool fourni : QCM à 4 options", async () => {
    for (const [id, meaning] of [
      ["猫|ねこ", "chat"],
      ["犬|いぬ", "chien"],
      ["鳥|とり", "oiseau"],
      ["本|ほん", "livre"],
      ["水|みず", "eau"],
    ]) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id,
        surface,
        reading,
        meaning,
        tags: [],
        status: "review",
        cards: { written: newCard(new Date("2020-01-01")) },
      });
    }
    const card = (await buildSession(NOW, { scope: "due" })).find((c) => c.id === "猫|ねこ")!;
    expect(card.mode).toBe("choice");
    if (card.mode !== "choice") throw new Error("expected choice exercise");
    expect(card.choices).toHaveLength(4);
    expect(new Set(card.choices).size).toBe(4);
  });
});

describe("ordre du deck", () => {
  /** Sème `n` mots dus, échéances identiques → seul le mélange peut les départager. */
  async function seedDue(n: number) {
    for (let i = 0; i < n; i++) {
      await putVocab({
        id: `mot${i}|mot${i}`,
        surface: `mot${i}`,
        reading: `mot${i}`,
        meaning: `sens${i}`,
        tags: [],
        status: "review",
        cards: { written: newCard(new Date("2020-01-01")) },
      });
    }
  }

  it("deux sessions successives ne servent pas les mots dans le même ordre", async () => {
    await seedDue(12);
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
      orders.add((await buildSession(NOW, { scope: "due" })).map((c) => c.id).join(","));
    }
    // 12! ordres possibles : obtenir 8 fois la même séquence signifierait qu'il n'y a
    // pas de mélange du tout (c'était le symptôme : tri par échéance + clés IndexedDB).
    expect(orders.size).toBeGreaterThan(1);
  });

  it("le mélange ne perd ni ne duplique d'exercice", async () => {
    await seedDue(12);
    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });
});

describe("buildSession", () => {
  it("scope:due sans items → []", async () => {
    const result = await buildSession(NOW, { scope: "due" });
    expect(result).toEqual([]);
  });

  it("scope:due avec 1 item dû → retourne exactement 1", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.length).toBe(1);
  });

  it("scope:due promeut les nouveaux items jusqu'au plafond newPerDay", async () => {
    // 15 nouveaux vocab (pas de carte)
    for (let i = 0; i < 15; i++) {
      await putVocab({
        id: `new|${i}`,
        surface: `new${i}`,
        reading: `new${i}`,
        meaning: `meaning${i}`,
        tags: [],
        status: "unknown",
        cards: {},
      });
    }
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.length).toBeLessThanOrEqual(SRS.newPerDay);
  });

  it("scope:due respecte le cap journalier : si introduced=newPerDay → 0 nouveaux promus", async () => {
    await bumpSrsDaily(TODAY, { introduced: SRS.newPerDay });
    for (let i = 0; i < 5; i++) {
      await putVocab({
        id: `new|${i}`,
        surface: `new${i}`,
        reading: `new${i}`,
        meaning: `meaning${i}`,
        tags: [],
        status: "unknown",
        cards: {},
      });
    }
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.length).toBe(0);
  });

  it("scope:due : après promotion de 3 items, getSrsDaily(today).introduced === 3", async () => {
    for (let i = 0; i < 3; i++) {
      await putVocab({
        id: `new|${i}`,
        surface: `new${i}`,
        reading: `new${i}`,
        meaning: `meaning${i}`,
        tags: [],
        status: "unknown",
        cards: {},
      });
    }
    await buildSession(NOW, { scope: "due" });
    const daily = await getSrsDaily(TODAY);
    expect(daily?.introduced).toBe(3);
  });

  it("scope:all avec lessonId : tous les items vocab de la leçon retournés (même sans cartes)", async () => {
    const lessonId = "n5-01-today-book";
    const vocabIds = ["今日|きょう", "日本語|にほんご", "本|ほん", "読む|よむ"];
    for (const id of vocabIds) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id,
        surface,
        reading,
        meaning: "test",
        tags: [],
        status: "unknown",
        cards: {},
      });
    }
    const result = await buildSession(NOW, { scope: "all", lessonId });
    expect(result.length).toBe(vocabIds.length);
  });

  it("gradeCard incrémente reviewed dans srsDaily", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    const cards = await buildSession(NOW, { scope: "due" });
    const card = cards.find((c) => c.id === "水|みず")!;
    await gradeCard(card, "good", NOW);
    const daily = await getSrsDaily(TODAY);
    expect(daily?.reviewed).toBe(1);
  });

  it("scope:due : WarmupCard vocab a context si item a example.ja", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
      example: { ja: "水を飲む", fr: "Boire de l'eau" },
    });
    const cards = await buildSession(NOW, { scope: "due" });
    const card = cards.find((c) => c.id === "水|みず")!;
    expect(card.context).toBe("水を飲む");
  });

  it("scope:all sans lessonId → []", async () => {
    const result = await buildSession(NOW, { scope: "all" });
    expect(result).toEqual([]);
  });

  it("scope:all : bilan plafonné à sessionAllCap", async () => {
    const lessonId = "n5-29-seasons"; // 14 mots dans le curriculum
    const entry = getCurriculumEntry(lessonId)!;
    expect(entry.introduces.vocab.length).toBeGreaterThan(SRS.sessionAllCap);
    for (const id of entry.introduces.vocab) {
      const [surface, reading] = id.split("|");
      await putVocab({ id, surface, reading, meaning: "test", tags: [], status: "unknown", cards: {} });
    }
    const result = await buildSession(NOW, { scope: "all", lessonId });
    expect(result.length).toBe(SRS.sessionAllCap);
  });

  it("scope:due : un mot kana sans sens (front = réponse) n'est pas servi", async () => {
    await putVocab({
      id: "ねこ|ねこ",
      surface: "ねこ",
      reading: "ねこ",
      meaning: "—",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.find((c) => c.id === "ねこ|ねこ")).toBeUndefined();
  });
});

describe("priorisation des nouveaux items", () => {
  it("budget serré : les objectifs d'une leçon commencée sont promus, pas l'incident", async () => {
    const { getCurriculum } = await import("./curriculum");
    const first = getCurriculum()[0];
    const lessonVocabIds = first.introduces.vocab.slice(0, 3);
    if (lessonVocabIds.length === 0) return; // curriculum sans vocab : rien à tester
    await putLessonProgress({ id: first.id, startedAt: Date.now() });

    // Mot incident (histoire) avec un id alphabétiquement AVANT ceux de la leçon : sans
    // priorisation, l'ordre des clés IndexedDB le ferait passer en premier.
    await putVocab({
      id: "ああ|ああ",
      surface: "ああ",
      reading: "ああ",
      meaning: "ah",
      tags: [],
      status: "unknown",
      cards: {},
    });
    for (const id of lessonVocabIds) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id,
        surface,
        reading: reading ?? surface,
        meaning: "test",
        tags: [],
        status: "unknown",
        cards: {},
      });
    }

    // Budget du jour réduit au nombre exact de mots de la leçon : c'est le seul cadre où
    // la priorisation se voit (l'ordre du deck, lui, est désormais mélangé).
    await bumpSrsDaily(TODAY, { introduced: SRS.newPerDay - lessonVocabIds.length });

    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    for (const id of lessonVocabIds) expect(ids).toContain(id);
    expect(ids).not.toContain("ああ|ああ");
  });

  it("vocabulaire incident : les graphies en kanji entrent en rotation d'abord", async () => {
    // Deux mots incidents (aucune leçon commencée), le mot kana AVANT le mot en kanji dans
    // l'ordre des clés : seule la priorisation peut inverser les deux.
    await putVocab({
      id: "あめ|あめ",
      surface: "あめ",
      reading: "あめ",
      meaning: "bonbon",
      tags: [],
      status: "unknown",
      cards: {},
    });
    await putVocab({
      id: "山|やま",
      surface: "山",
      reading: "やま",
      meaning: "montagne",
      tags: [],
      status: "unknown",
      cards: {},
    });
    // Une seule nouveauté promue aujourd'hui : c'est le mot en kanji qui doit la prendre.
    await bumpSrsDaily(TODAY, { introduced: SRS.newPerDay - 1 });

    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    expect(ids).toContain("山|やま");
    expect(ids).not.toContain("あめ|あめ");
  });
});

describe("scope story (exercices du Lecteur)", () => {
  async function seedWord(id: string, meaning: string) {
    const [surface, reading] = id.split("|");
    await putVocab({ id, surface, reading, meaning, tags: [], status: "unknown", cards: {} });
  }

  it("ne sert que les mots demandés, et n'amorce aucune carte FSRS", async () => {
    await seedWord("猫|ねこ", "chat");
    await seedWord("犬|いぬ", "chien");
    await seedWord("鳥|とり", "oiseau");

    const session = await buildSession(NOW, { scope: "story", vocabIds: ["猫|ねこ", "犬|いぬ"] });
    expect(session.map((c) => c.id).sort()).toEqual(["猫|ねこ", "犬|いぬ"].sort());
    // Lire une histoire n'introduit pas d'items dans la planification.
    expect((await getVocab("猫|ねこ"))?.cards.written).toBeUndefined();
    expect((await getSrsDaily(TODAY))?.introduced ?? 0).toBe(0);
  });

  it("ignore les ids absents de la base plutôt que d'échouer", async () => {
    await seedWord("猫|ねこ", "chat");
    const session = await buildSession(NOW, { scope: "story", vocabIds: ["猫|ねこ", "inconnu|x"] });
    expect(session.map((c) => c.id)).toEqual(["猫|ねこ"]);
  });

  it("sans mot ni point de grammaire → []", async () => {
    expect(await buildSession(NOW, { scope: "story" })).toEqual([]);
  });
});

describe("plafond de session (sessionCap)", () => {
  it("coupe aux items les plus urgents et n'ajoute pas de nouveauté", async () => {
    // sessionCap + 10 items dus, échéances étalées (les plus anciens = les plus urgents)
    for (let i = 0; i < SRS.sessionCap + 10; i++) {
      await putVocab({
        id: `due|${i}`,
        surface: `due${i}`,
        reading: `due${i}`,
        meaning: `m${i}`,
        tags: [],
        status: "review",
        cards: { written: newCard(new Date(2020, 0, 1 + i)) },
      });
    }
    // Et des candidats nouveaux qui ne doivent PAS être promus (plus de place)
    for (let i = 0; i < 3; i++) {
      await putVocab({
        id: `fresh|${i}`,
        surface: `fresh${i}`,
        reading: `fresh${i}`,
        meaning: `f${i}`,
        tags: [],
        status: "unknown",
        cards: {},
      });
    }
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.length).toBe(SRS.sessionCap);
    // Les plus urgents (dates les plus anciennes) sont gardés
    expect(session.some((c) => c.id === "due|0")).toBe(true);
    expect(session.some((c) => c.id === `due|${SRS.sessionCap + 9}`)).toBe(false);
    // Aucune nouveauté promue, et le budget du jour n'a pas été consommé
    expect(session.some((c) => c.id.startsWith("fresh|"))).toBe(false);
    expect((await getSrsDaily(TODAY))?.introduced ?? 0).toBe(0);
  });
});

/** Carte FSRS stabilisée (état Review, due dans le futur). */
function stableCard(dueInDays: number): Card {
  const due = new Date(NOW);
  due.setDate(due.getDate() + dueInDays);
  return {
    ...newCard(new Date("2026-06-01")),
    due,
    state: State.Review,
    scheduled_days: 7,
    reps: 3,
  };
}

describe("compétence écoute (cards.oral, séparée de l'écrit)", () => {
  it("carte écoute due → exercice d'écoute, même si l'écrit n'est pas dû", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: stableCard(10), oral: newCard(new Date("2020-01-01")) },
      example: { ja: "水を飲む" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    const listen = session.find((c) => c.key === "vocab-listen:水|みず");
    expect(listen).toBeDefined();
    expect(listen!.skill).toBe("oral");
    // L'écrit n'est pas dû : pas d'exercice écrit en double.
    expect(session.find((c) => c.key === "vocab:水|みず")).toBeUndefined();
  });

  it("mode sans le son : la carte écoute due devient un exercice écrit noté oral, pas d'amorçage", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    localStorage.setItem("settings", JSON.stringify({ silentReviews: true }));
    try {
      await putVocab({
        id: "水|みず",
        surface: "水",
        reading: "みず",
        meaning: "eau",
        tags: [],
        status: "review",
        cards: { written: stableCard(10), oral: newCard(new Date("2020-01-01")) },
        example: { ja: "水を飲む" },
      });
      await putVocab({
        id: "猫|ねこ",
        surface: "猫",
        reading: "ねこ",
        meaning: "chat",
        tags: [],
        status: "review",
        cards: { written: stableCard(10) },
        example: { ja: "猫がいる" },
      });
      const session = await buildSession(NOW, { scope: "due" });
      const silent = session.find((c) => c.key === "vocab-listen-silent:水|みず");
      expect(silent).toBeDefined();
      expect(silent!.skill).toBe("oral");
      expect(silent!.audio).toBeUndefined();
      // Pas de nouvelle carte écoute amorcée tant que le son est coupé.
      expect(session.find((c) => c.key === "vocab-listen:猫|ねこ")).toBeUndefined();
      expect((await getVocab("猫|ねこ"))?.cards.oral).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("pause « je ne peux pas écouter » : écrit tant qu'elle court, écoute de nouveau après", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      await putVocab({
        id: "水|みず",
        surface: "水",
        reading: "みず",
        meaning: "eau",
        tags: [],
        status: "review",
        cards: { written: stableCard(10), oral: newCard(new Date("2020-01-01")) },
        example: { ja: "水を飲む" },
      });

      localStorage.setItem(
        "settings",
        JSON.stringify({ silentUntil: NOW.getTime() + 10 * 60 * 1000 }),
      );
      const paused = await buildSession(NOW, { scope: "due" });
      expect(paused.find((c) => c.key === "vocab-listen-silent:水|みず")).toBeDefined();

      // Pause expirée : le son revient tout seul, sans réglage à retoucher.
      localStorage.setItem(
        "settings",
        JSON.stringify({ silentUntil: NOW.getTime() - 60 * 1000 }),
      );
      const after = await buildSession(NOW, { scope: "due" });
      expect(after.find((c) => c.key === "vocab-listen:水|みず")).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("silenceDeck : les exercices d'écoute restants passent à l'écrit, les autres ne bougent pas", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: stableCard(10), oral: newCard(new Date("2020-01-01")) },
      example: { ja: "水を飲む" },
    });
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });

    const deck = await buildSession(NOW, { scope: "due" });
    const listen = deck.find((c) => c.audio);
    expect(listen).toBeDefined();

    const silenced = await silenceDeck(deck);
    // Même nombre de cartes, aucune ne demande plus le son.
    expect(silenced).toHaveLength(deck.length);
    expect(silenced.every((c) => !c.audio)).toBe(true);
    const replacement = silenced.find((c) => c.key === "vocab-listen-silent:水|みず");
    expect(replacement?.skill).toBe("oral");
    // Les cartes écrites traversent inchangées (même objet).
    const written = deck.find((c) => c.key.startsWith("vocab:猫"));
    expect(silenced).toContain(written);
  });

  it("amorçage : un mot stable à l'écrit (Review) avec exemple gagne une carte écoute", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      cards: { written: stableCard(10) },
      example: { ja: "猫がいる" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.find((c) => c.key === "vocab-listen:猫|ねこ")).toBeDefined();
    const item = await getVocab("猫|ねこ");
    expect(item?.cards.oral).toBeDefined();
  });

  it("pas d'amorçage pour un mot encore en apprentissage à l'écrit", async () => {
    await putVocab({
      id: "犬|いぬ",
      surface: "犬",
      reading: "いぬ",
      meaning: "chien",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) }, // état New, dû
      example: { ja: "犬が走る" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.find((c) => c.key === "vocab-listen:犬|いぬ")).toBeUndefined();
  });

  it("rotation des variantes d'écoute selon le nombre de révisions de la carte", () => {
    const base = newCard(new Date("2020-01-01"));
    expect(pickOralVariant({ ...base, reps: 0 })).toBe("type");
    expect(pickOralVariant({ ...base, reps: 1 })).toBe("meaning");
    expect(pickOralVariant({ ...base, reps: 2 })).toBe("dictation");
    expect(pickOralVariant({ ...base, reps: 3 })).toBe("type");
  });

  it("variante sens : QCM audio-only quand le pool fournit 3 distracteurs", async () => {
    for (let i = 0; i < 3; i++) {
      await putVocab({
        id: `pool|${i}`,
        surface: `pool${i}`,
        reading: `pool${i}`,
        meaning: `sens${i}`,
        tags: [],
        status: "review",
        cards: { written: stableCard(10) },
      });
    }
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: stableCard(10), oral: { ...newCard(new Date("2020-01-01")), reps: 1 } },
      example: { ja: "水を飲む。" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    const listen = session.find((c) => c.key === "vocab-listen-meaning:水|みず");
    expect(listen).toBeDefined();
    expect(listen!.audioOnly).toBe(true);
    expect(listen!.skill).toBe("oral");
    if (listen!.mode !== "choice") throw new Error("expected choice exercise");
    expect(listen!.choices).toContain("eau");
    expect(listen!.choices).toHaveLength(4);
  });

  it("variante dictée : reconstruction audio-only pour une phrase courte", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: stableCard(10), oral: { ...newCard(new Date("2020-01-01")), reps: 2 } },
      example: { ja: "水を飲む。" }, // 4 tuiles avec le tokenizer simulé
    });
    const session = await buildSession(NOW, { scope: "due" });
    const dictation = session.find((c) => c.key === "vocab-dictation:水|みず");
    expect(dictation).toBeDefined();
    expect(dictation!.mode).toBe("build");
    expect(dictation!.audioOnly).toBe(true);
  });

  it("variante dictée retombe sur la saisie quand la phrase est trop longue", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: stableCard(10), oral: { ...newCard(new Date("2020-01-01")), reps: 2 } },
      example: { ja: "とてもながいぶんしょうをきいてかきとるのはむずかしい。" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.find((c) => c.key === "vocab-dictation:水|みず")).toBeUndefined();
    expect(session.find((c) => c.key === "vocab-listen:水|みず")).toBeDefined();
  });

  it("noter un exercice d'écoute met à jour cards.oral, pas cards.written", async () => {
    const written = stableCard(10);
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written, oral: newCard(new Date("2020-01-01")) },
      example: { ja: "水を飲む" },
    });
    const session = await buildSession(NOW, { scope: "due" });
    const listen = session.find((c) => c.key === "vocab-listen:水|みず")!;
    await gradeCard(listen, "good", NOW);
    const item = await getVocab("水|みず");
    expect(item!.cards.oral!.due.getTime()).toBeGreaterThan(NOW.getTime());
    expect(item!.cards.written!.due.getTime()).toBe(written.due.getTime());
  });
});

describe("compétence production (cards.production, cloze en contexte)", () => {
  function vocabProd(id: string, cards: VocabCards, example = true) {
    const [surface, reading] = id.split("|");
    return putVocab({
      id,
      surface,
      reading,
      meaning: `sens-${surface}`,
      tags: [],
      status: "review",
      cards,
      ...(example ? { example: { ja: `${surface}がある。`, fr: `Il y a ${surface}.` } } : {}),
    });
  }
  type VocabCards = Parameters<typeof putVocab>[0]["cards"];

  it("carte production due → exercice cloze, plafonné à prodMax", async () => {
    for (let i = 0; i < SRS.prodMax + 2; i++) {
      await vocabProd(`prod${i}|prod${i}`, {
        written: stableCard(10),
        production: newCard(new Date("2020-01-01")),
      });
    }
    const session = await buildSession(NOW, { scope: "due" });
    const prods = session.filter((c) => c.key.startsWith("vocab-produce:"));
    expect(prods.length).toBe(SRS.prodMax);
    expect(prods[0].skill).toBe("production");
  });

  it("amorçage : écrit stable (Review + intervalle de déblocage) avec exemple, plafonné à prodSeeds", async () => {
    for (let i = 0; i < SRS.prodSeeds + 1; i++) {
      await vocabProd(`seed${i}|seed${i}`, { written: stableCard(10) });
    }
    const session = await buildSession(NOW, { scope: "due" });
    const prods = session.filter((c) => c.key.startsWith("vocab-produce:"));
    expect(prods.length).toBe(SRS.prodSeeds);
    const seeded = await getVocab("seed0|seed0");
    expect(seeded?.cards.production).toBeDefined();
  });

  it("pas d'amorçage sous l'intervalle de déblocage, ni sans exemple", async () => {
    const fresh = { ...stableCard(10), scheduled_days: SRS.unlockIntervalDays - 1 };
    await vocabProd("jeune|jeune", { written: fresh });
    await vocabProd("nu|nu", { written: stableCard(10) }, false);
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.some((c) => c.key.startsWith("vocab-produce:"))).toBe(false);
    expect((await getVocab("jeune|jeune"))?.cards.production).toBeUndefined();
    expect((await getVocab("nu|nu"))?.cards.production).toBeUndefined();
  });

  it("sessionStats compte les cartes production dues", async () => {
    await vocabProd("水|みず", {
      written: stableCard(10),
      oral: stableCard(10),
      production: newCard(new Date("2020-01-01")),
    });
    const { sessionStats } = await import("./reviewSession");
    const stats = await sessionStats(NOW);
    expect(stats.dueCount).toBe(1);
  });

  it("noter une production met à jour cards.production uniquement", async () => {
    const written = stableCard(10);
    await vocabProd("本|ほん", { written, production: newCard(new Date("2020-01-01")) });
    const session = await buildSession(NOW, { scope: "due" });
    const prod = session.find((c) => c.key === "vocab-produce:本|ほん")!;
    await gradeCard(prod, "good", NOW);
    const item = await getVocab("本|ほん");
    expect(item!.cards.production!.reps).toBe(1);
    expect(item!.cards.written!.due.getTime()).toBe(written.due.getTime());
  });
});
