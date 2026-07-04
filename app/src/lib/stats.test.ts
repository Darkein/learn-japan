import { describe, expect, it } from "vitest";
import { SRS } from "./config";
import { localDateString, type ReviewLog, type VocabItem } from "./db";
import { newCard } from "./srs";
import {
  collectCards,
  leechIds,
  perItemAccuracy,
  retentionRate,
  reviewForecast,
} from "./stats";

const DAY = 86_400_000;
const NOW = new Date("2026-07-04T12:00:00");

function log(p: Partial<ReviewLog> & { itemId: string; at: number }): ReviewLog {
  return { track: "vocab", grade: "good", ...p };
}

describe("perItemAccuracy", () => {
  it("agrège total/échecs/dernière révision par (piste, élément)", () => {
    const reviews = [
      log({ itemId: "猫|ねこ", at: 100, grade: "again" }),
      log({ itemId: "猫|ねこ", at: 300, grade: "good" }),
      log({ itemId: "猫|ねこ", at: 200, grade: "again", skill: "oral" }),
      log({ itemId: "n5-wa-topic", track: "grammar", at: 50 }),
    ];
    const acc = perItemAccuracy(reviews);
    expect(acc.get("vocab:猫|ねこ")).toEqual({ total: 3, again: 2, lastAt: 300 });
    expect(acc.get("grammar:n5-wa-topic")).toEqual({ total: 1, again: 0, lastAt: 50 });
  });

  it("sépare les pistes partageant un même id (grammaire vs compréhension)", () => {
    const reviews = [
      log({ itemId: "n5-wa-topic", track: "grammar", at: 1 }),
      log({ itemId: "n5-wa-topic", track: "comprehension", at: 2, grade: "again" }),
    ];
    const acc = perItemAccuracy(reviews);
    expect(acc.get("grammar:n5-wa-topic")!.again).toBe(0);
    expect(acc.get("comprehension:n5-wa-topic")!.again).toBe(1);
  });
});

describe("retentionRate", () => {
  it("exclut la première révision de chaque (élément, compétence)", () => {
    const t = NOW.getTime();
    const reviews = [
      log({ itemId: "a", at: t - 5 * DAY, grade: "again" }), // première → exclue
      log({ itemId: "a", at: t - 3 * DAY, grade: "good" }),
      log({ itemId: "a", at: t - 1 * DAY, grade: "again" }),
      log({ itemId: "b", at: t - 2 * DAY, grade: "good" }), // première → exclue
    ];
    const r = retentionRate(reviews, 30, NOW);
    expect(r.total).toBe(2);
    expect(r.correct).toBe(1);
    expect(r.rate).toBe(0.5);
  });

  it("la première révision hors fenêtre compte comme exposition (pas de re-première)", () => {
    const t = NOW.getTime();
    const reviews = [
      log({ itemId: "a", at: t - 100 * DAY, grade: "good" }), // première, hors fenêtre
      log({ itemId: "a", at: t - 2 * DAY, grade: "good" }), // comptée
    ];
    const r = retentionRate(reviews, 30, NOW);
    expect(r.total).toBe(1);
    expect(r.correct).toBe(1);
  });

  it("distingue les compétences : la première oral est exclue même si written existe", () => {
    const t = NOW.getTime();
    const reviews = [
      log({ itemId: "a", at: t - 5 * DAY, skill: "written" }),
      log({ itemId: "a", at: t - 3 * DAY, skill: "oral", grade: "again" }), // première oral → exclue
    ];
    const r = retentionRate(reviews, 30, NOW);
    expect(r.total).toBe(0);
    expect(r.rate).toBeNull();
  });
});

describe("reviewForecast", () => {
  function vocabWithDue(dues: Date[]): VocabItem {
    const cards: VocabItem["cards"] = {};
    const skills = ["written", "oral", "production"] as const;
    dues.forEach((due, i) => {
      cards[skills[i]] = { ...newCard(NOW), due };
    });
    return { id: "x|x", surface: "x", reading: "x", meaning: "x", tags: [], status: "review", cards };
  }

  it("bucketise par jour local et clampe les retards dans le jour 0", () => {
    const v = vocabWithDue([
      new Date(NOW.getTime() - 10 * DAY), // en retard → jour 0
      new Date(NOW.getTime() + 2 * DAY),
      new Date(NOW.getTime() + 30 * DAY), // hors fenêtre → ignorée
    ]);
    const days = reviewForecast(collectCards([v], [], []), NOW, 7);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe(localDateString(NOW));
    expect(days[0].count).toBe(1);
    expect(days[2].count).toBe(1);
    expect(days.reduce((s, d) => s + d.count, 0)).toBe(2);
  });
});

describe("leechIds", () => {
  it("seuil = SRS.leechLapses échecs", () => {
    const reviews: ReviewLog[] = [];
    for (let i = 0; i < SRS.leechLapses; i++) reviews.push(log({ itemId: "leech", at: i, grade: "again" }));
    for (let i = 0; i < SRS.leechLapses - 1; i++) reviews.push(log({ itemId: "ok", at: i, grade: "again" }));
    const ids = leechIds(reviews);
    expect(ids.has("leech")).toBe(true);
    expect(ids.has("ok")).toBe(false);
  });
});
