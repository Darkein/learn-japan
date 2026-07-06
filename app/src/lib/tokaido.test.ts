import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { TOKAIDO } from "../data/tokaido";
import { _resetDbForTests, getMeta, putMeta } from "./db";
import {
  addTokaidoBonus,
  computeTokaidoPosition,
  estimateLessonsToNext,
  levelStatsFromLessons,
  markStationCelebrated,
  tokaidoStatus,
  type TokaidoLessonLike,
} from "./tokaido";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

function lesson(
  level: number,
  { done = false, mastery = 0, items = 4 }: { done?: boolean; mastery?: number; items?: number } = {},
): TokaidoLessonLike {
  return {
    level,
    completedAt: done ? Date.now() : undefined,
    mastery,
    introduces: { vocab: Array.from({ length: items }, (_, i) => `v${i}`), grammar: [] },
  };
}

describe("données TOKAIDO", () => {
  it("contient 55 points d'index continus, de Nihonbashi à Sanjō Ōhashi", () => {
    expect(TOKAIDO).toHaveLength(55);
    TOKAIDO.forEach((s, i) => expect(s.index).toBe(i));
    expect(TOKAIDO[0].romaji).toBe("Nihonbashi");
    expect(TOKAIDO[54].romaji).toBe("Sanjō Ōhashi");
  });
});

describe("computeTokaidoPosition", () => {
  it("part de Nihonbashi (position 0) sans progression", () => {
    const pos = computeTokaidoPosition({ levels: [], bonus: 0, maxReached: 0 });
    expect(pos.position).toBe(0);
    expect(pos.station.kanji).toBe("日本橋");
    expect(pos.next?.kanji).toBe("品川");
  });

  it("N5 complet et maîtrisé → position 11 (Hakone franchi, segment N5 fini)", () => {
    const levels = levelStatsFromLessons([
      lesson(5, { done: true, mastery: 1 }),
      lesson(5, { done: true, mastery: 1 }),
    ]);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    expect(pos.position).toBeCloseTo(11);
    expect(pos.station.index).toBe(11);
  });

  it("pondère 60 % leçons / 40 % maîtrise dans le segment", () => {
    // 1 leçon sur 2 terminée, maîtrise nulle → 11 × 0.6 × 0.5 = 3.3
    const levels = levelStatsFromLessons([lesson(5, { done: true }), lesson(5)]);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    expect(pos.position).toBeCloseTo(3.3);
    expect(pos.station.index).toBe(3);
    expect(pos.betweenPct).toBe(30);
  });

  it("les niveaux s'additionnent (N5 fini + N4 entamé)", () => {
    const levels = levelStatsFromLessons([
      lesson(5, { done: true, mastery: 1 }),
      lesson(4, { done: true, mastery: 0.5 }),
      lesson(4),
    ]);
    // N5 : 11 ; N4 : 11 × (0.6×0.5 + 0.4×0.25) = 4.4
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    expect(pos.position).toBeCloseTo(15.4);
  });

  it("ne recule jamais sous maxReached et ne dépasse jamais 54", () => {
    const pos = computeTokaidoPosition({ levels: [], bonus: 0, maxReached: 7.2 });
    expect(pos.position).toBe(7.2);
    const end = computeTokaidoPosition({ levels: [], bonus: 100, maxReached: 0 });
    expect(end.position).toBe(54);
    expect(end.next).toBeUndefined();
    expect(end.betweenPct).toBe(100);
  });
});

describe("estimateLessonsToNext", () => {
  it("estime les leçons restantes vers la prochaine station", () => {
    const lessons = Array.from({ length: 27 }, (_, i) => lesson(5, { done: i < 5, mastery: i < 5 ? 1 : 0 }));
    const levels = levelStatsFromLessons(lessons);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    const est = estimateLessonsToNext(pos, levels);
    expect(est).toBeGreaterThanOrEqual(1);
    expect(est).toBeLessThanOrEqual(3);
  });
});

describe("tokaidoStatus (IO)", () => {
  it("persiste la monotonie : la position ne recule pas quand les leçons régressent", async () => {
    const done = [lesson(5, { done: true, mastery: 1 }), lesson(5, { done: true, mastery: 1 })];
    const first = await tokaidoStatus(done);
    expect(first.pos.position).toBeCloseTo(11);
    // Les cartes vieillissent, la maîtrise retombe → la position affichée reste acquise.
    const regressed = [lesson(5, { done: true, mastery: 0.2 }), lesson(5, { done: true, mastery: 0.2 })];
    const second = await tokaidoStatus(regressed);
    expect(second.pos.position).toBeCloseTo(11);
  });

  it("signale une arrivée uniquement au franchissement, une seule fois", async () => {
    const none = await tokaidoStatus([lesson(5)]);
    expect(none.newlyArrived).toBeUndefined();

    const some = await tokaidoStatus([lesson(5, { done: true, mastery: 1 }), lesson(5)]);
    // 11 × (0.6×0.5 + 0.4×0.5) = 5.5 → station 5 franchie
    expect(some.newlyArrived?.index).toBe(5);

    await markStationCelebrated(5);
    const again = await tokaidoStatus([lesson(5, { done: true, mastery: 1 }), lesson(5)]);
    expect(again.newlyArrived).toBeUndefined();
  });

  it("le bonus omikuji avance la position, clampé à 1 par appel", async () => {
    await addTokaidoBonus(0.25);
    await addTokaidoBonus(5); // clampé à 1
    expect(await getMeta<number>("tokaido.bonus")).toBeCloseTo(1.25);
    const status = await tokaidoStatus([]);
    expect(status.pos.position).toBeCloseTo(1.25);
  });

  it("markStationCelebrated ne régresse pas", async () => {
    await putMeta("tokaido.lastCelebrated", 8);
    await markStationCelebrated(3);
    expect(await getMeta<number>("tokaido.lastCelebrated")).toBe(8);
  });
});
