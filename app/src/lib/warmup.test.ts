import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, beforeEach } from "vitest";
import { putKanji, putVocab, getSrsDaily, bumpSrsDaily, _resetDbForTests } from "./db";
import { newCard } from "./srs";
import { SRS } from "./config";
import { dueCards, gradeCard, buildSession } from "./warmup";

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

    const due = await dueCards(NOW);
    const card = due.find((c) => c.id === "水|みず");
    expect(card).toBeDefined();
    expect(card!.front).toBe("eau");
    expect(card!.back).toBe("水（みず）");

    await gradeCard(card!, "good", NOW);
    const due2 = await dueCards(NOW);
    expect(due2.find((c) => c.id === "水|みず")).toBeUndefined();
  });

  it("vocab : carte en saisie active, accepte le mot écrit OU la lecture", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    const card = (await dueCards(NOW)).find((c) => c.id === "猫|ねこ")!;
    expect(card.mode).toBe("type");
    expect(card.front).toBe("chat");
    expect(card.answers).toEqual(expect.arrayContaining(["猫", "ねこ"]));
  });

  it("kanji : saisie active, accepte une lecture on/kun (radical d'okurigana inclus)", async () => {
    await putKanji({
      id: "食",
      kanji: "食",
      meanings: ["manger"],
      on: ["ショク"],
      kun: ["た.べる"],
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const card = (await dueCards(NOW)).find((c) => c.id === "食")!;
    expect(card.mode).toBe("type");
    expect(card.answers).toEqual(expect.arrayContaining(["しょく", "た", "たべる"]));
  });
});

describe("buildSession", () => {
  it("scope:due sans items → []", async () => {
    const result = await buildSession(NOW, { scope: "due" });
    expect(result).toEqual([]);
  });

  it("scope:due avec 2 items dus → retourne exactement 2", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      cards: { written: newCard(new Date("2020-01-01")) },
    });
    await putKanji({
      id: "食",
      kanji: "食",
      meanings: ["manger"],
      on: ["ショク"],
      kun: ["た.べる"],
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const result = await buildSession(NOW, { scope: "due" });
    expect(result.length).toBe(2);
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

  it("scope:all avec lessonId : tous les items de la leçon retournés (même sans cartes)", async () => {
    const lessonId = "n5-01-today-book";
    // Items de cette leçon (introduces.vocab = ["今日|きょう", "日本語|にほんご", "本|ほん", "読む|よむ"])
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
    // kanji de n5-01-today-book: ["今", "日", "本", "語", "読"]
    const kanjiIds = ["今", "日", "本", "語", "読"];
    for (const id of kanjiIds) {
      await putKanji({
        id,
        kanji: id,
        meanings: ["test"],
        on: [],
        kun: [],
        tags: [],
        status: "unknown",
      });
    }
    const result = await buildSession(NOW, { scope: "all", lessonId });
    expect(result.length).toBe(vocabIds.length + kanjiIds.length);
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
});
