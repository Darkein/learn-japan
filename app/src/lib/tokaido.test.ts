import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ROUTES, routeForLevel } from "../data/routes";
import { _resetDbForTests, getMeta, putMeta } from "./db";
import {
  activeLevel,
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

describe("données ROUTES", () => {
  it("une route par niveau JLPT, du Tōkaidō (N5) au henro (N1)", () => {
    expect(ROUTES.map((r) => r.level)).toEqual([5, 4, 3, 2, 1]);
    expect(routeForLevel(5).name).toBe("Tōkaidō");
    expect(routeForLevel(1).stations).toHaveLength(88);
  });

  it("chaque route a des index continus et des extrémités attendues", () => {
    const ends: Record<number, [string, string]> = {
      5: ["Nihonbashi", "Sanjō Ōhashi"],
      4: ["Nihonbashi", "Shimosuwa"],
      3: ["Nihonbashi", "Sanjō Ōhashi"],
      2: ["Fukagawa", "Ōgaki"],
      1: ["Ryōzen-ji", "Ōkubo-ji"],
    };
    for (const r of ROUTES) {
      r.stations.forEach((s, i) => expect(s.index, `${r.name}[${i}]`).toBe(i));
      expect(r.stations[0].romaji).toBe(ends[r.level][0]);
      expect(r.stations[r.stations.length - 1].romaji).toBe(ends[r.level][1]);
    }
  });
});

describe("activeLevel", () => {
  it("N5 tant que ses leçons ne sont pas toutes terminées", () => {
    expect(activeLevel(levelStatsFromLessons([lesson(5, { done: true }), lesson(5)]))).toBe(5);
    expect(activeLevel([])).toBe(5);
  });

  it("passe à N4 dès que N5 est achevé, même sans maîtrise parfaite", () => {
    const levels = levelStatsFromLessons([
      lesson(5, { done: true, mastery: 0.4 }),
      lesson(4),
    ]);
    expect(activeLevel(levels)).toBe(4);
  });
});

describe("computeTokaidoPosition", () => {
  it("part de Nihonbashi (position 0) sans progression", () => {
    const pos = computeTokaidoPosition({ levels: [], bonus: 0, maxReached: 0 });
    expect(pos.route.level).toBe(5);
    expect(pos.position).toBe(0);
    expect(pos.station.kanji).toBe("日本橋");
    expect(pos.next?.kanji).toBe("品川");
  });

  it("pondère 60 % leçons / 40 % maîtrise sur toute la route", () => {
    // 1 leçon sur 2 terminée, maîtrise nulle → 54 × 0.6 × 0.5 = 16.2
    const levels = levelStatsFromLessons([lesson(5, { done: true }), lesson(5)]);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    expect(pos.position).toBeCloseTo(16.2);
    expect(pos.station.index).toBe(16);
    expect(pos.betweenPct).toBe(20);
  });

  it("N5 achevé → on repart de zéro sur le Kōshū Kaidō (N4)", () => {
    const levels = levelStatsFromLessons([
      lesson(5, { done: true, mastery: 0.5 }),
      lesson(4, { done: true, mastery: 0 }),
      lesson(4),
    ]);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    expect(pos.route.name).toBe("Kōshū Kaidō");
    // 45 × 0.6 × 0.5 = 13.5 — la progression N5 ne compte plus, la route est neuve.
    expect(pos.position).toBeCloseTo(13.5);
  });

  it("ne recule jamais sous maxReached et ne dépasse jamais le terme", () => {
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
    const lessons = Array.from({ length: 67 }, (_, i) => lesson(5, { done: i < 5, mastery: i < 5 ? 1 : 0 }));
    const levels = levelStatsFromLessons(lessons);
    const pos = computeTokaidoPosition({ levels, bonus: 0, maxReached: 0 });
    const est = estimateLessonsToNext(pos, levels);
    expect(est).toBeGreaterThanOrEqual(1);
    expect(est).toBeLessThanOrEqual(2);
  });
});

describe("tokaidoStatus (IO)", () => {
  it("persiste la monotonie par niveau : la position ne recule pas quand la maîtrise retombe", async () => {
    const half = [lesson(5, { done: true, mastery: 1 }), lesson(5)];
    const first = await tokaidoStatus(half);
    // 54 × (0.6×0.5 + 0.4×0.5) = 27
    expect(first.pos.position).toBeCloseTo(27);
    const regressed = [lesson(5, { done: true, mastery: 0.2 }), lesson(5)];
    const second = await tokaidoStatus(regressed);
    expect(second.pos.position).toBeCloseTo(27);
  });

  it("signale une arrivée uniquement au franchissement, une seule fois", async () => {
    const none = await tokaidoStatus([lesson(5)]);
    expect(none.newlyArrived).toBeUndefined();

    const some = await tokaidoStatus([lesson(5, { done: true, mastery: 1 }), lesson(5)]);
    // 54 × (0.6×0.5 + 0.4×0.5) = 27 → station 27 franchie
    expect(some.newlyArrived?.station.index).toBe(27);
    expect(some.newlyArrived?.route.level).toBe(5);

    await markStationCelebrated(5, 27);
    const again = await tokaidoStatus([lesson(5, { done: true, mastery: 1 }), lesson(5)]);
    expect(again.newlyArrived).toBeUndefined();
  });

  it("un terme de route achevée non fêté prime sur la route suivante", async () => {
    const done = [lesson(5, { done: true, mastery: 0.5 }), lesson(4)];
    const status = await tokaidoStatus(done);
    expect(status.pos.route.level).toBe(4);
    expect(status.pos.position).toBe(0);
    expect(status.newlyArrived?.route.level).toBe(5);
    expect(status.newlyArrived?.station.romaji).toBe("Sanjō Ōhashi");

    await markStationCelebrated(5, 54);
    const after = await tokaidoStatus(done);
    expect(after.newlyArrived).toBeUndefined();
  });

  it("le bonus omikuji avance la position, clampé à 1 par appel", async () => {
    await addTokaidoBonus(0.25);
    await addTokaidoBonus(5); // clampé à 1
    expect(await getMeta<number>("tokaido.bonus")).toBeCloseTo(1.25);
    const status = await tokaidoStatus([]);
    expect(status.pos.position).toBeCloseTo(1.25);
  });

  it("markStationCelebrated ne régresse pas", async () => {
    await putMeta("tokaido.lastCelebrated.5", 8);
    await markStationCelebrated(5, 3);
    expect(await getMeta<number>("tokaido.lastCelebrated.5")).toBe(8);
  });

  it("migre l'ancien schéma : fraction du segment N5 → fraction du Tōkaidō entier", async () => {
    // Ancien monde : position 5.5 sur les segments de 11 (N5 à moitié), station 5 fêtée.
    await putMeta("tokaido.maxReached", 5.5);
    await putMeta("tokaido.lastCelebrated", 5);
    const status = await tokaidoStatus([]);
    // 5.5/11 = 50 % du segment N5 → 50 % du Tōkaidō = 27.
    expect(status.pos.position).toBeCloseTo(27);
    expect(await getMeta<number>("tokaido.maxReached.5")).toBeCloseTo(27);
    // 5/11 → floor(0.4545… × 54) = 24 ; pas de rafale : seule la dernière station se fête.
    expect(await getMeta<number>("tokaido.lastCelebrated.5")).toBe(24);
    expect(status.newlyArrived?.station.index).toBe(27);
    // La migration ne rejoue pas.
    await putMeta("tokaido.maxReached", 11);
    const again = await tokaidoStatus([]);
    expect(again.pos.position).toBeCloseTo(27);
  });
});
