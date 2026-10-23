import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Card } from "ts-fsrs";
import { getVocab, putVocab, putLessonProgress, getSrsDaily, putMeta, _resetDbForTests } from "./db";
import { newCard, State } from "./srs";
import { SRS } from "./config";
import { REVIEW_STEP_SIZE } from "./path";
import { PRODUCTION_MIN_DAYS } from "./vocabDrills";
import { gradeCard, buildSession, silenceDeck, spreadApart } from "./reviewSession";
import type { Exercise } from "./exercise";
import { vocabTypeExercise } from "./exerciseBuild";
import { getCurriculumEntry } from "./curriculum";
import type { KuromojiToken } from "./tokenizer";

// Corpus d'exemples statique neutralisé : ces tests raisonnent sur les seuls items
// qu'ils sèment — le corpus réel (examples.json) évolue via le workflow build-examples
// et fournirait sinon des exemples inattendus (amorçage écoute, cloze).
// Les phrases générées par point (grammar-examples.json) aussi : un test les sème au besoin.
const grammarExtra = vi.hoisted(() => ({}) as Record<string, { ja: string; fr?: string }[]>);
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: () => null,
  grammarExamples: (id: string) => grammarExtra[id] ?? [],
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
const INCIDENTAL_PURGE_KEY = "purge.incidentalCards.v2";

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
    // Plus dû : son échéance s'éloigne (il ne revient qu'en complément, cf. éléments fragiles).
    expect((await getVocab("水|みず"))!.card!.due.getTime()).toBeGreaterThan(NOW.getTime() + 86_400_000);
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
    expect(ids).toHaveLength(REVIEW_STEP_SIZE);
    expect(new Set(ids).size).toBe(REVIEW_STEP_SIZE);
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

describe("l'étape Révision ne crée aucune carte", () => {
  it("le vocabulaire sans carte (histoire, leçon) n'entre jamais en rotation par la révision", async () => {
    // Les cartes naissent dans les étapes Vocabulaire et Grammaire du parcours : l'étape
    // Révision ne promeut plus rien, quelle que soit la leçon commencée.
    await putLessonProgress({ id: "n5-01-today-book", startedAt: Date.now() });
    await putVocab({ id: "本|ほん", surface: "本", reading: "ほん", meaning: "livre", tags: [], status: "unknown" });
    await putVocab({ id: "山|やま", surface: "山", reading: "やま", meaning: "montagne", tags: [], status: "unknown" });
    const deck = await buildSession(NOW, { scope: "due" });
    expect(deck).toHaveLength(0);
    expect((await getVocab("本|ほん"))?.card).toBeUndefined();
    expect((await getVocab("山|やま"))?.card).toBeUndefined();
  });

  it("un mot incident ajouté à la main garde sa carte et revient en révision", async () => {
    // Chemin manuel (tap du Lecteur) : la carte existe déjà, la séance la sert comme
    // n'importe quelle carte due.
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

describe("étape Révision : 10 cartes, les dues d'abord, puis les plus fragiles", () => {
  async function seedWord(id: string, card: Card) {
    await putVocab({ id, surface: id, reading: id, meaning: `sens ${id}`, tags: [], status: "review", card });
  }

  it("un gros retard sert REVIEW_STEP_SIZE cartes, les plus urgentes d'abord", async () => {
    for (let i = 0; i < 42; i++) await seedWord(`due${i}`, newCard(new Date(2020, 0, 1 + i)));
    const session = await buildSession(NOW, { scope: "due" });
    expect(session).toHaveLength(REVIEW_STEP_SIZE);
    expect(session.some((c) => c.id === "due0")).toBe(true);
    expect(session.some((c) => c.id === "due41")).toBe(false);
  });

  it("peu de dû : l'étape complète avec les éléments les plus fragiles", async () => {
    await seedWord("dû", newCard(new Date("2020-01-01")));
    // Révisés, pas dus : l'un revu hier (solide), l'autre il y a longtemps (fragile).
    const reviewedAt = (d: string) => ({ ...stableCard(30), last_review: new Date(d), stability: 3 });
    await seedWord("solide", reviewedAt("2026-06-29"));
    await seedWord("fragile", reviewedAt("2026-04-01"));
    const ids = (await buildSession(NOW, { scope: "due" })).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["dû", "solide", "fragile"]));
    expect(ids).toHaveLength(3);
  });

  it("une carte jamais révisée (neuve, pas encore due) n'est pas un complément", async () => {
    const fresh = newCard(new Date("2026-06-30T07:00:00"));
    await seedWord("neuf", { ...fresh, due: new Date("2026-07-02") });
    expect(await buildSession(NOW, { scope: "due" })).toEqual([]);
  });

  it("révision ciblée : les éléments demandés, dus ou non, sans complément", async () => {
    await seedWord("raté", stableCard(10));
    await seedWord("autre", newCard(new Date("2020-01-01")));
    const ids = (await buildSession(NOW, { scope: "due", itemIds: ["raté"] })).map((c) => c.id);
    expect(ids).toEqual(["raté"]);
  });
});

describe("rappels des leçons précédentes et station de repos (SPEC §5.4)", () => {
  /** Sème les mots d'une leçon du curriculum, déjà révisés (Review, pas dus). */
  async function seedReviewed(lessonIndex: number) {
    const { getCurriculum } = await import("./curriculum");
    const e = getCurriculum()[lessonIndex];
    for (const id of e.introduces.vocab) {
      const [surface, reading] = id.split("|");
      await putVocab({
        id, surface, reading: reading ?? surface, meaning: `sens ${id}`, tags: [], status: "review",
        card: { ...stableCard(20), last_review: new Date("2026-06-01"), stability: 5 },
      });
    }
    return e;
  }

  it("l'étape Révision réserve des places aux mots de la leçon N−1, même non dus", async () => {
    const { getCurriculum } = await import("./curriculum");
    const prev = await seedReviewed(0);
    const deck = await buildSession(NOW, { scope: "due", lessonId: getCurriculum()[1].id });
    const recalls = deck.filter((ex) => ex.key.startsWith("recall:"));
    expect(recalls).toHaveLength(2);
    expect(recalls.every((ex) => prev.introduces.vocab.includes(ex.id) && ex.level === 2)).toBe(true);
  });

  it("sans leçon en cours, pas de rappel : la révision ordinaire", async () => {
    await seedReviewed(0);
    const deck = await buildSession(NOW, { scope: "due" });
    expect(deck.some((ex) => ex.key.startsWith("recall:"))).toBe(false);
  });

  it("la station de repos révise les leçons données, aux niveaux 2 et 3", async () => {
    const e = await seedReviewed(0);
    const deck = await buildSession(NOW, { scope: "rest", lessonIds: [e.id] });
    expect(deck.length).toBe(e.introduces.vocab.length);
    expect(new Set(deck.map((ex) => ex.level))).toEqual(new Set([2, 3]));
    expect(deck.every((ex) => e.introduces.vocab.includes(ex.id))).toBe(true);
  });
});

describe("étapes de leçon (scope step)", () => {
  const lessonId = "n5-01-today-book";
  const entry = () => getCurriculumEntry(lessonId)!;

  async function seedLesson(over: Partial<{ status: "unknown" | "known" | "review"; card: Card }> = {}) {
    for (const id of entry().introduces.vocab) {
      const [surface, reading] = id.split("|");
      await putVocab({ id, surface, reading: reading ?? surface, meaning: `sens ${id}`, tags: [], status: "unknown", ...over });
    }
  }

  it("Vocabulaire : deux exercices par mot, tout le niveau 1 avant le niveau 2", async () => {
    await seedLesson();
    const deck = await buildSession(NOW, { scope: "step", lessonId, step: "vocab" });
    const n = entry().introduces.vocab.length;
    expect(deck).toHaveLength(2 * n);
    expect(deck.slice(0, n).every((ex) => ex.key.endsWith("#n1"))).toBe(true);
    expect(deck.slice(n).every((ex) => ex.key.endsWith("#n2"))).toBe(true);
    // Niveau 1 = reconnaissance en QCM (ou saisie quand le pool manque de distracteurs).
    expect(new Set(deck.map((ex) => ex.key)).size).toBe(2 * n);
  });

  it("les mots reçoivent leur carte à la première rencontre, et comptent comme introduits", async () => {
    await seedLesson();
    await buildSession(NOW, { scope: "step", lessonId, step: "vocab" });
    for (const id of entry().introduces.vocab) expect((await getVocab(id))?.card).toBeDefined();
    expect((await getSrsDaily(TODAY))?.introduced).toBe(entry().introduces.vocab.length);
  });

  it("Vocabulaire ne sert pas les mots déjà acquis ; Produire les sert tous", async () => {
    await seedLesson({ status: "known" });
    expect(await buildSession(NOW, { scope: "step", lessonId, step: "vocab" })).toEqual([]);
    const produce = await buildSession(NOW, { scope: "step", lessonId, step: "produce" });
    const vocabIds = new Set(entry().introduces.vocab);
    expect(produce.filter((ex) => vocabIds.has(ex.id))).toHaveLength(vocabIds.size);
    expect(produce.every((ex) => ex.key.endsWith("#n3"))).toBe(true);
  });

  it("Grammaire : niveau 1 (rôle, emploi) avant niveau 2 (phrase à reconstruire)", async () => {
    const deck = await buildSession(NOW, { scope: "step", lessonId, step: "grammar" });
    const n1 = deck.filter((ex) => ex.level === 1);
    const n2 = deck.filter((ex) => ex.level === 2);
    expect(deck.slice(0, n1.length)).toEqual(n1);
    expect(n1.every((ex) => ex.track === "grammar" && ex.mode === "choice")).toBe(true);
    // Au niveau 1, chaque point a son rôle, et son emploi quand une phrase s'y prête —
    // jamais un second QCM de rôle à sa place : c'était la même question deux fois
    // (l'emploi lui-même est testé dans exam.test.ts : le tokeniseur bouchonné d'ici ne sait
    // pas le placer).
    const rules = n1.filter((ex) => ex.form === "grammar-rule");
    expect(rules).toHaveLength(entry().introduces.grammar.length);
    expect(new Set(rules.map((ex) => ex.id)).size).toBe(rules.length);
    expect(n2.map((ex) => ex.form)).toContain("grammar-build");
  });

  it("Grammaire : la phrase à reconstruire varie entre l'exemple et les phrases du point", async () => {
    const generated = { ja: "私は先生です。", fr: "Je suis professeur." };
    grammarExtra["n5-wa-topic"] = [generated];
    try {
      const contexts = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const deck = await buildSession(NOW, { scope: "step", lessonId, step: "grammar" });
        for (const ex of deck) {
          if (ex.id === "n5-wa-topic" && ex.form === "grammar-build" && "context" in ex) contexts.add(ex.context!);
        }
      }
      expect(contexts).toContain(generated.ja);
      expect(contexts.size).toBe(2);
    } finally {
      delete grammarExtra["n5-wa-topic"];
    }
  });

  it("Produire : niveau 3 pour tous les éléments, sans le son ni dictée", async () => {
    const store = new Map<string, string>([["settings", JSON.stringify({ silentReviews: true })]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      await seedLesson({ status: "known" });
      const deck = await buildSession(NOW, { scope: "step", lessonId, step: "produce" });
      expect(deck.every((ex) => ex.level === 3)).toBe(true);
      expect(deck.some((ex) => ex.form === "dictation" || ex.form === "grammar-dictation")).toBe(false);
      expect(deck.filter((ex) => ex.track === "vocab").map((ex) => ex.form)).toEqual(
        entry().introduces.vocab.map(() => "production"),
      );
    } finally {
      vi.unstubAllGlobals();
    }
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

  /** Mot MÛR (Review, au-dessus du seuil de production) et DÛ, avec sa phrase d'exemple,
   *  qui a atteint le niveau 3 du parcours (`level`) : aucune borne de niveau ne s'applique. */
  async function seedMature(
    id: string,
    opts: { example?: boolean; scheduledDays?: number; state?: State; level?: 1 | 2 | 3 } = {},
  ) {
    const [surface, reading] = id.split("|");
    await putVocab({
      id,
      surface,
      reading,
      meaning: `sens-${surface}`,
      tags: [],
      status: "review",
      level: opts.level ?? 3,
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

  it("la forme ne dépasse jamais le niveau atteint dans une leçon pas finie (SPEC §2.2)", async () => {
    // 水 est un objectif de leçon : niveau 1 atteint seulement → l'écrit et rien d'autre ;
    // niveau 2 → l'écoute s'ouvre, pas encore la production ni la dictée.
    await seedPool();
    await seedMature("水|みず", { level: 1 });
    expect(await kindsOver(15, "水|みず")).toEqual([WRITTEN]);
    await seedMature("水|みず", { level: 2 });
    const kinds = await kindsOver(40, "水|みず");
    expect(kinds).not.toContain("vocab-produce");
    expect(kinds).not.toContain("vocab-dictation");
  });

  it("un mot encore en apprentissage ne sort qu'à l'écrit", async () => {
    // On ne fait pas écouter — ni produire — un mot qu'on vient de rencontrer.
    await seedMature("犬|いぬ", { state: State.Learning });
    await seedPool();
    expect(await kindsOver(15, "犬|いぬ")).toEqual([WRITTEN]);
  });

  it("production fermée tant que le mot n'est pas stable", async () => {
    await seedMature("本|ほん", { scheduledDays: PRODUCTION_MIN_DAYS - 1 });
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

describe("spreadApart", () => {
  const ex = (id: string, context?: string, track: "vocab" | "grammar" = "grammar"): Exercise => ({
    mode: "choice", key: `${id}:${context ?? ""}`, track, id, front: "", back: "", choices: [], answerIndex: 0, ...(context ? { context } : {}),
  });
  const conflict = (a: Exercise, b: Exercise) => (a.track === b.track && a.id === b.id) || (!!a.context && a.context === b.context);

  it("ne fait pas se suivre deux exercices du même élément ni sur la même phrase", () => {
    const list = [ex("a", "山に猫がいる。"), ex("b", "山に猫がいる。"), ex("a"), ex("c"), ex("b")];
    const out = spreadApart(list);
    expect(out).toHaveLength(list.length);
    for (let i = 1; i < out.length; i++) expect(conflict(out[i - 1], out[i])).toBe(false);
  });

  it("tient compte de l'exercice qui précède la suite", () => {
    expect(spreadApart([ex("a"), ex("b")], ex("a"))[0].id).toBe("b");
  });

  it("garde l'ordre quand rien ne peut s'écarter", () => {
    const list = [ex("a"), ex("a", "x")];
    expect(spreadApart(list)).toEqual(list);
  });
});
