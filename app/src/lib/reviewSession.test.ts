import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Card } from "ts-fsrs";
import { getVocab, putVocab, putLessonProgress, getSrsDaily, bumpSrsDaily, putMeta, _resetDbForTests } from "./db";
import { newCard, State } from "./srs";
import { SRS } from "./config";
import { gradeCard, buildSession, reviewBlockSize, silenceDeck } from "./reviewSession";
import { vocabTypeExercise } from "./exerciseBuild";
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

// Drapeau de la passe unique `purgeIncidentalCards` (lib/vocab.ts) : posé d'office pour
// que les tests raisonnent sur les items qu'ils sèment (hors curriculum pour la plupart,
// donc tous démontés par la purge). Le describe dédié le remet à zéro.
const INCIDENTAL_PURGE_KEY = "purge.incidentalCards";

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
  await putMeta(INCIDENTAL_PURGE_KEY, true);
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
      card: newCard(new Date("2020-01-01")),
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
      card: newCard(new Date("2020-01-01")),
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
        card: newCard(new Date("2020-01-01")),
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
        card: newCard(new Date("2020-01-01")),
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
      card: newCard(new Date("2020-01-01")),
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
      });
    }
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.length).toBe(0);
  });

  it("un retard supérieur à l'objectif n'empêche plus les nouveautés (progression gelée)", async () => {
    // Le cas signalé : 42 éléments dus, objectif du jour plus petit → l'ancienne règle
    // (« pas de neuf tant que le dû remplit le bloc ») ne promouvait plus AUCUN objectif
    // de la leçon commencée. Sans carte, ses items ne se stabilisaient jamais : contrôle
    // jamais ouvert, leçon suivante jamais déverrouillée.
    const lessonId = "n5-01-today-book";
    const ids = getCurriculumEntry(lessonId)!.introduces.vocab.slice(0, 3);
    await putLessonProgress({ id: lessonId, startedAt: Date.now() });
    for (const id of ids) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id,
        surface,
        reading: reading ?? surface,
        meaning: "test",
        tags: [],
        status: "unknown",
      });
    }
    for (let i = 0; i < 42; i++) {
      await putVocab({
        id: `due|${i}`,
        surface: `due${i}`,
        reading: `due${i}`,
        meaning: `m${i}`,
        tags: [],
        status: "review",
        card: newCard(new Date(2020, 0, 1 + i)),
      });
    }
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.some((c) => ids.includes(c.id))).toBe(true);
    expect((await getSrsDaily(TODAY))?.introduced).toBeGreaterThan(0);
    // Le retard avance quand même : la réserve de nouveautés n'occupe pas tout le bloc.
    expect(session.some((c) => c.id.startsWith("due|"))).toBe(true);
  });

  it("scope:due : après promotion de 3 objectifs, getSrsDaily(today).introduced === 3", async () => {
    // Seuls les objectifs d'une leçon COMMENCÉE sont promus (cf. newVocabToPromote) : le
    // compteur du jour se mesure donc sur des mots du curriculum.
    const lessonId = "n5-01-today-book";
    const ids = getCurriculumEntry(lessonId)!.introduces.vocab.slice(0, 3);
    await putLessonProgress({ id: lessonId, startedAt: Date.now() });
    for (const id of ids) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id,
        surface,
        reading: reading ?? surface,
        meaning: "test",
        tags: [],
        status: "unknown",
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
      card: newCard(new Date("2020-01-01")),
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
      card: newCard(new Date("2020-01-01")),
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
      await putVocab({ id, surface, reading, meaning: "test", tags: [], status: "unknown" });
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
      card: newCard(new Date("2020-01-01")),
    });
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.find((c) => c.id === "ねこ|ねこ")).toBeUndefined();
  });
});

describe("promotion des nouveaux items", () => {
  it("budget serré : les objectifs d'une leçon commencée sont promus, pas l'incident", async () => {
    const { getCurriculum } = await import("./curriculum");
    const { effectiveNewPerDay } = await import("./tuning");
    const first = getCurriculum()[0];
    // Débit EFFECTIF du jour : le réglage `newPerDay` est plafonné par ce que l'objectif
    // quotidien peut absorber (cf. lib/tuning.ts) — c'est lui, le budget à saturer.
    const newCap = effectiveNewPerDay(SRS.newPerDay, null, 0, SRS.dailyGoal);
    const lessonVocabIds = first.introduces.vocab.slice(0, Math.min(3, newCap));
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
      });
    }

    // Budget du jour réduit au nombre exact de mots de la leçon : c'est le seul cadre où
    // la priorisation se voit (l'ordre du deck, lui, est désormais mélangé).
    await bumpSrsDaily(TODAY, { introduced: newCap - lessonVocabIds.length });

    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    for (const id of lessonVocabIds) expect(ids).toContain(id);
    expect(ids).not.toContain("ああ|ああ");
  });

  it("budget large : le vocabulaire incident n'entre jamais en rotation tout seul", async () => {
    // Les mots d'une histoire sont matérialisés en base à la lecture (`enrollStory`) sans
    // carte. Leçon commencée et budget de nouveautés intact (ses objectifs, eux, ne sont
    // pas en base) : la session ne doit pourtant rien promouvoir — un mot croisé dans une
    // histoire ne s'ajoute que depuis le texte.
    await putLessonProgress({ id: "n5-01-today-book", startedAt: Date.now() });
    await putVocab({
      id: "あめ|あめ",
      surface: "あめ",
      reading: "あめ",
      meaning: "bonbon",
      tags: [],
      status: "unknown",
    });
    await putVocab({
      id: "山|やま",
      surface: "山",
      reading: "やま",
      meaning: "montagne",
      tags: [],
      status: "unknown",
    });

    const deck = await buildSession(NOW, { scope: "due" });
    expect(deck).toHaveLength(0);
    expect((await getVocab("山|やま"))?.card).toBeUndefined();
    expect((await getVocab("あめ|あめ"))?.card).toBeUndefined();
  });

  it("un mot incident ajouté à la main garde sa carte et revient en révision", async () => {
    // Chemin manuel (tap du Lecteur / exercices de l'histoire) : la carte existe déjà,
    // la session la sert comme n'importe quelle carte due.
    await putVocab({
      id: "あめ|あめ",
      surface: "あめ",
      reading: "あめ",
      meaning: "bonbon",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    expect(ids).toContain("あめ|あめ");
  });
});

describe("purge du vocabulaire incident déjà promu", () => {
  beforeEach(async () => {
    await putMeta(INCIDENTAL_PURGE_KEY, false); // base d'avant le correctif
  });

  it("retire les cartes des mots hors objectifs et garde celles des objectifs", async () => {
    const { getCurriculum } = await import("./curriculum");
    const lessonVocabId = getCurriculum()[0].introduces.vocab[0];
    if (!lessonVocabId) return; // curriculum sans vocab : rien à tester
    const [surface, reading] = lessonVocabId.split("|");
    await putVocab({
      id: lessonVocabId,
      surface,
      reading: reading ?? surface,
      meaning: "test",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
      streak: 2,
    });
    await putVocab({
      id: "あめ|あめ",
      surface: "あめ",
      reading: "あめ",
      meaning: "bonbon",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
      streak: 2,
    });

    await buildSession(NOW, { scope: "due" });

    const incidental = await getVocab("あめ|あめ");
    expect(incidental?.card).toBeUndefined();
    expect(incidental?.card).toBeUndefined();
    // L'item reste en base (lecteur, glossaire, distracteurs) avec son statut.
    expect(incidental?.status).toBe("review");
    expect((await getVocab(lessonVocabId))?.card).toBeDefined();
  });

  it("passe une seule fois : un mot réajouté ensuite garde sa carte", async () => {
    await buildSession(NOW, { scope: "due" }); // pose le drapeau de purge

    await putVocab({
      id: "あめ|あめ",
      surface: "あめ",
      reading: "あめ",
      meaning: "bonbon",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    await buildSession(NOW, { scope: "due" });
    expect((await getVocab("あめ|あめ"))?.card).toBeDefined();
  });
});

describe("scope story (exercices du Lecteur)", () => {
  async function seedWord(id: string, meaning: string) {
    const [surface, reading] = id.split("|");
    await putVocab({ id, surface, reading, meaning, tags: [], status: "unknown" });
  }

  it("ne sert que les mots demandés, et n'amorce aucune carte FSRS", async () => {
    await seedWord("猫|ねこ", "chat");
    await seedWord("犬|いぬ", "chien");
    await seedWord("鳥|とり", "oiseau");

    const session = await buildSession(NOW, { scope: "story", vocabIds: ["猫|ねこ", "犬|いぬ"] });
    expect(session.map((c) => c.id).sort()).toEqual(["猫|ねこ", "犬|いぬ"].sort());
    // Lire une histoire n'introduit pas d'items dans la planification.
    expect((await getVocab("猫|ねこ"))?.card).toBeUndefined();
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

describe("taille d'un bloc de révision (objectif du jour, plafond dur)", () => {
  it("reviewBlockSize : ce qu'il reste pour atteindre l'objectif, puis un bloc plein", () => {
    // Objectif de 10 : un bloc en sert 10, et 6 s'il en reste 6 à faire.
    expect(reviewBlockSize(10, 0)).toBe(10);
    expect(reviewBlockSize(10, 4)).toBe(6);
    // Objectif atteint (bloc de renforcement du flux) → un bloc plein de plus.
    expect(reviewBlockSize(10, 10)).toBe(10);
    expect(reviewBlockSize(10, 25)).toBe(10);
    // `sessionCap` reste le plafond dur, et un bloc n'est jamais vide.
    expect(reviewBlockSize(200, 0)).toBe(SRS.sessionCap);
    expect(reviewBlockSize(1, 0)).toBe(1);
  });

  it("un objectif de 10 sert 10 cartes, pas les 42 du retard", async () => {
    const store = new Map<string, string>([["settings", JSON.stringify({ dailyGoal: 10 })]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      for (let i = 0; i < 42; i++) {
        await putVocab({
          id: `due|${i}`,
          surface: `due${i}`,
          reading: `due${i}`,
          meaning: `m${i}`,
          tags: [],
          status: "review",
          card: newCard(new Date(2020, 0, 1 + i)),
        });
      }
      const session = await buildSession(NOW, { scope: "due" });
      expect(session.length).toBe(10);
      // Le plus urgent (échéance la plus ancienne) est dedans.
      expect(session.some((c) => c.id === "due|0")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
        card: newCard(new Date(2020, 0, 1 + i)),
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
      });
    }
    const session = await buildSession(NOW, { scope: "due" });
    // Bloc dimensionné par l'objectif du jour (20 par défaut), pas par le retard.
    expect(session.length).toBe(SRS.dailyGoal);
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

describe("tirage de la forme d'exercice (un mot, une carte)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** Préfixe de clé = la FORME servie (cf. lib/exerciseBuild.ts). */
  const WRITTEN = "vocab";
  const ALL_KINDS = ["vocab", "vocab-listen", "vocab-listen-meaning", "vocab-dictation", "vocab-produce"];

  /** Mot MÛR (Review, au-dessus du seuil de déblocage) et DÛ, avec sa phrase d'exemple. */
  async function seedMature(
    id: string,
    opts: { example?: boolean; scheduledDays?: number; state?: State } = {},
  ) {
    const [surface, reading] = id.split("|");
    await putVocab({
      id,
      surface,
      reading,
      meaning: `sens-${surface}`,
      tags: [],
      status: "review",
      card: {
        ...stableCard(-1), // échue hier
        state: opts.state ?? State.Review,
        scheduled_days: opts.scheduledDays ?? 7,
      },
      ...(opts.example === false ? {} : { example: { ja: `${surface}をのむ。`, fr: `On boit ${surface}.` } }),
    });
  }

  /** Pool de distracteurs : le QCM de sens à l'écoute en exige trois. */
  async function seedPool() {
    for (let i = 0; i < 6; i++) await seedMature(`autre${i}|autre${i}`);
  }

  /** Formes servies à `id` sur `n` sessions — le tirage est aléatoire, on l'observe. */
  async function kindsOver(n: number, id: string): Promise<string[]> {
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const session = await buildSession(NOW, { scope: "due" });
      for (const ex of session.filter((c) => c.id === id)) seen.add(ex.key.split(":")[1] ? ex.key.split(":")[0] : ex.key);
    }
    return [...seen];
  }

  it("un mot dû ne donne QU'UN exercice, quelle que soit la forme tirée", async () => {
    await seedMature("水|みず");
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.filter((c) => c.id === "水|みず")).toHaveLength(1);
  });

  it("les cinq formes sortent au fil des sessions", async () => {
    await seedMature("水|みず");
    await seedPool();
    const kinds = await kindsOver(60, "水|みず");
    for (const k of ALL_KINDS) expect(kinds).toContain(k);
  });

  it("jamais deux fois de suite la même forme", async () => {
    // Sans phrase d'exemple, seules deux formes sont recevables : l'écrit et la dictée du
    // mot. La précédente étant l'écrit, le tirage est donc déterminé.
    await seedMature("水|みず", { example: false });
    const v = (await getVocab("水|みず"))!;
    await putVocab({ ...v, lastDrill: "written" });
    const session = await buildSession(NOW, { scope: "due" });
    expect(session.find((c) => c.id === "水|みず")!.key).toBe("vocab-listen:水|みず");
    // Et le tirage retenu est mémorisé pour la fois suivante.
    expect((await getVocab("水|みず"))?.lastDrill).toBe("listen-word");
  });

  it("un mot encore en apprentissage ne sort qu'à l'écrit", async () => {
    // On ne fait pas écouter — ni produire — un mot qu'on vient de rencontrer.
    await seedMature("犬|いぬ", { state: State.Learning });
    await seedPool();
    expect(await kindsOver(15, "犬|いぬ")).toEqual([WRITTEN]);
  });

  it("production fermée tant que le mot n'est pas stable", async () => {
    await seedMature("本|ほん", { scheduledDays: SRS.unlockIntervalDays - 1 });
    await seedPool();
    expect(await kindsOver(30, "本|ほん")).not.toContain("vocab-produce");
  });

  it("sans le son, aucune forme d'écoute n'est tirée", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    localStorage.setItem("settings", JSON.stringify({ silentReviews: true }));
    try {
      await seedMature("水|みず");
      await seedPool();
      const kinds = await kindsOver(25, "水|みず");
      expect(kinds).not.toContain("vocab-listen");
      expect(kinds).not.toContain("vocab-listen-meaning");
      expect(kinds).not.toContain("vocab-dictation");
      expect(kinds.sort()).toEqual([WRITTEN, "vocab-produce"].sort());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("pause « je ne peux pas écouter » : plus d'écoute tant qu'elle court, de nouveau après", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      // Sans exemple : écrit et dictée du mot pour seules formes — l'écoute se voit donc
      // à coup sûr dès qu'elle est autorisée (la précédente est l'écrit).
      await seedMature("水|みず", { example: false });
      const v = (await getVocab("水|みず"))!;
      await putVocab({ ...v, lastDrill: "written" });

      localStorage.setItem("settings", JSON.stringify({ silentUntil: NOW.getTime() + 10 * 60 * 1000 }));
      const paused = await buildSession(NOW, { scope: "due" });
      expect(paused.find((c) => c.id === "水|みず")!.audio).toBeUndefined();

      // Pause expirée : le son revient tout seul, sans réglage à retoucher.
      localStorage.setItem("settings", JSON.stringify({ silentUntil: NOW.getTime() - 60 * 1000 }));
      const after = await buildSession(NOW, { scope: "due" });
      expect(after.find((c) => c.key === "vocab-listen:水|みず")).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("silenceDeck : les exercices d'écoute d'un deck déjà construit passent à l'écrit", async () => {
    await seedMature("水|みず");
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const water = (await getVocab("水|みず"))!;
    // Deck monté à la main : le tirage est aléatoire, ce test porte sur silenceDeck seul.
    const listen = await vocabTypeExercise(water, NOW.getTime(), { listen: true, pool: [water] });
    const written = await buildSession(NOW, { scope: "due" }).then(
      (deck) => deck.find((c) => c.id === "猫|ねこ")!,
    );
    const silenced = await silenceDeck([listen, written]);

    expect(silenced).toHaveLength(2);
    expect(silenced.every((c) => !c.audio)).toBe(true);
    expect(silenced[0].key).toBe("vocab-listen-silent:水|みず");
    expect(silenced[0].skill).toBe("oral");
    // Les exercices sans son traversent inchangés (même objet).
    expect(silenced).toContain(written);
  });

  it("noter n'importe quelle forme replanifie LA carte du mot", async () => {
    await seedMature("水|みず");
    await seedPool();
    const session = await buildSession(NOW, { scope: "due" });
    const ex = session.find((c) => c.id === "水|みず")!;
    await gradeCard(ex, "good", NOW);

    const item = (await getVocab("水|みず"))!;
    // La carte semée porte déjà 3 révisions : la note en ajoute une, sur CETTE carte —
    // il n'y en a pas d'autre à toucher.
    expect(item.card!.reps).toBe(4);
    expect(item.card!.due.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("sessionStats compte un mot dû UNE fois", async () => {
    await seedMature("水|みず");
    const { sessionStats } = await import("./reviewSession");
    expect((await sessionStats(NOW)).dueCount).toBe(1);
  });

  it("les exercices d'une histoire passent les mots les plus urgents d'abord", async () => {
    // Un mot planifié loin (déjà su) ne doit pas prendre la place d'un mot dû.
    const overdue = (): Card => ({
      ...newCard(new Date("2020-01-01")),
      state: State.Review,
      scheduled_days: 7,
      reps: 3,
    });
    const far = { ...overdue(), due: new Date(NOW.getTime() + 90 * DAY) };
    const ids: string[] = [];
    for (let i = 0; i < SRS.sessionAllCap + 2; i++) {
      const id = `mot${i}|mot${i}`;
      ids.push(id);
      await putVocab({
        id,
        surface: `mot${i}`,
        reading: `mot${i}`,
        meaning: `sens-${i}`,
        tags: [],
        status: "review",
        card: i < 2 ? far : overdue(),
      });
    }

    const session = await buildSession(NOW, { scope: "story", vocabIds: ids });
    expect(session).toHaveLength(SRS.sessionAllCap);
    expect(session.some((c) => c.id === "mot0|mot0" || c.id === "mot1|mot1")).toBe(false);
  });
});
