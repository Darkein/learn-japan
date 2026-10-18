import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { ROUTES, routeForLevel } from "../data/routes";
import { _resetDbForTests, getMeta, putMeta } from "./db";
import {
  activeLevel,
  addFortuneStamp,
  computeTokaidoPosition,
  fortuneStamps,
  levelStatsFromLessons,
  markStationCelebrated,
  stampTotal,
  stationStep,
  tokaidoStatus,
  type TokaidoLessonLike,
} from "./tokaido";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

const STEPS7 = ["course", "vocab", "grammar", "review", "story", "produce", "exam"];

function lesson(level: number, { done = false, stepsDone = 0 }: { done?: boolean; stepsDone?: number } = {}): TokaidoLessonLike {
  return {
    level,
    completedAt: done ? Date.now() : undefined,
    steps: STEPS7,
    stepsDone: done ? STEPS7 : STEPS7.slice(0, stepsDone),
  };
}

/** N leçons de 7 étapes au niveau donné, les `done` premières terminées. */
function lessons(level: number, n: number, done = 0): TokaidoLessonLike[] {
  return Array.from({ length: n }, (_, i) => lesson(level, { done: i < done }));
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

  it("passe à N4 dès que N5 est achevé", () => {
    const levels = levelStatsFromLessons([lesson(5, { done: true }), lesson(4)]);
    expect(activeLevel(levels)).toBe(4);
  });
});

describe("stationStep", () => {
  it("répartit les villes sur les étapes du niveau, la dernière sur le contrôle final", () => {
    // Tōkaidō : 54 tronçons ; 67 leçons de 7 étapes = 469 étapes.
    expect(stationStep(0, 469, 54)).toBe(0);
    expect(stationStep(1, 469, 54)).toBe(9);
    expect(stationStep(27, 469, 54)).toBe(235);
    expect(stationStep(54, 469, 54)).toBe(469);
    // Plus de villes que d'étapes : plusieurs villes sur la même étape, jamais au-delà.
    expect(stationStep(88, 20, 88)).toBe(20);
    expect(stationStep(3, 0, 54)).toBe(0);
  });
});

describe("computeTokaidoPosition", () => {
  it("part de Nihonbashi (position 0) sans progression", () => {
    const pos = computeTokaidoPosition([]);
    expect(pos.route.level).toBe(5);
    expect(pos.position).toBe(0);
    expect(pos.station.kanji).toBe("日本橋");
    expect(pos.next?.kanji).toBe("品川");
  });

  it("la position compte les étapes faites du niveau (SPEC §5c.4)", () => {
    // 67 leçons, 10 terminées = 70 étapes sur 469 ; la ville 8 tombe à l'étape 69, la 9 à 78.
    const pos = computeTokaidoPosition(levelStatsFromLessons(lessons(5, 67, 10)));
    expect(pos.stepsDone).toBe(70);
    expect(pos.stepsTotal).toBe(469);
    expect(pos.station.index).toBe(8);
    expect(pos.stepsToNext).toBe(8);
    expect(pos.betweenPct).toBe(11);
    expect(pos.position).toBeCloseTo(8 + 1 / 9);
  });

  it("chaque étape d'une leçon en cours fait avancer, jamais jusqu'au bout sans le contrôle", () => {
    const at = (n: number) =>
      computeTokaidoPosition(levelStatsFromLessons([lesson(5, { stepsDone: n }), ...lessons(5, 66)]));
    expect(at(0).stepsDone).toBe(0);
    expect(at(3).stepsDone).toBe(3);
    expect(at(3).position).toBeGreaterThan(at(2).position);
    // Toutes les étapes cochées sans l'admission : la dernière reste à faire.
    expect(at(7).stepsDone).toBe(6);
    const almost = levelStatsFromLessons([lesson(5, { stepsDone: 7 })]);
    expect(activeLevel(almost)).toBe(5);
  });

  it("une leçon sans grammaire compte six étapes", () => {
    const six: TokaidoLessonLike = { level: 5, steps: STEPS7.filter((s) => s !== "grammar"), stepsDone: [] };
    expect(levelStatsFromLessons([six, lesson(5)])[0].stepsTotal).toBe(13);
  });

  it("N5 achevé → on repart de zéro sur le Kōshū Kaidō (N4), la route N5 est faite", () => {
    const levels = levelStatsFromLessons([...lessons(5, 2, 2), ...lessons(4, 4, 2)]);
    const pos = computeTokaidoPosition(levels);
    expect(pos.route.name).toBe("Kōshū Kaidō");
    expect(pos.stepsDone).toBe(14);
    expect(pos.stepsTotal).toBe(28);
    // 14 étapes sur 28 : les villes 22 et 23 tombent toutes deux sur l'étape 14.
    expect(Math.floor(pos.position)).toBe(23);
  });

  it("N5 achevé sans leçon N4 : on attend au départ du Kōshū Kaidō", () => {
    const pos = computeTokaidoPosition(levelStatsFromLessons(lessons(5, 3, 3)));
    // N5 achevé et aucun N4 : la route active est le Kōshū Kaidō, au départ.
    expect(pos.route.level).toBe(4);
    expect(pos.position).toBe(0);
  });
});

describe("tokaidoStatus (IO)", () => {
  it("signale une arrivée uniquement au franchissement, une seule fois", async () => {
    const none = await tokaidoStatus(lessons(5, 67));
    expect(none.newlyArrived).toBeUndefined();

    const some = await tokaidoStatus(lessons(5, 67, 10));
    expect(some.newlyArrived?.station.index).toBe(8);
    expect(some.newlyArrived?.route.level).toBe(5);
    // Une seule fiche : la dernière ville, et les sept franchies avant elle.
    expect(some.newlyArrived?.others.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(some.stamps[5]).toBe(8);

    await markStationCelebrated(5, 8);
    const again = await tokaidoStatus(lessons(5, 67, 10));
    expect(again.newlyArrived).toBeUndefined();
  });

  it("un terme de route achevée non fêté prime sur la route suivante", async () => {
    const done = [...lessons(5, 2, 2), lesson(4)];
    const status = await tokaidoStatus(done);
    expect(status.pos.route.level).toBe(4);
    expect(status.pos.position).toBe(0);
    expect(status.newlyArrived?.route.level).toBe(5);
    expect(status.newlyArrived?.station.romaji).toBe("Sanjō Ōhashi");
    expect(status.stamps[5]).toBe(54);
    expect(stampTotal(status.stamps)).toBe(54);

    await markStationCelebrated(5, 54);
    const after = await tokaidoStatus(done);
    expect(after.newlyArrived).toBeUndefined();
  });

  it("une ville déjà fêtée par l'ancien calcul garde son tampon, sans seconde fête", async () => {
    await putMeta("tokaido.routesMigrated", true);
    await putMeta("tokaido.lastCelebrated.5", 12);
    const status = await tokaidoStatus(lessons(5, 67, 10));
    expect(Math.floor(status.pos.position)).toBe(8);
    expect(status.stamps[5]).toBe(12);
    expect(status.newlyArrived).toBeUndefined();
  });

  it("markStationCelebrated ne régresse pas", async () => {
    await putMeta("tokaido.lastCelebrated.5", 8);
    await markStationCelebrated(5, 3);
    expect(await getMeta<number>("tokaido.lastCelebrated.5")).toBe(8);
  });

  it("migre l'ancien schéma : la station fêtée du segment N5 devient sa fraction du Tōkaidō", async () => {
    await putMeta("tokaido.lastCelebrated", 5);
    await tokaidoStatus([]);
    // 5/11 → floor(0.4545… × 54) = 24.
    expect(await getMeta<number>("tokaido.lastCelebrated.5")).toBe(24);
    // La migration ne rejoue pas.
    await putMeta("tokaido.lastCelebrated", 11);
    await tokaidoStatus([]);
    expect(await getMeta<number>("tokaido.lastCelebrated.5")).toBe(24);
  });
});

describe("tampons de fortune", () => {
  it("un par jour au plus, dans l'ordre", async () => {
    await addFortuneStamp({ date: "2026-10-01", fortune: "kichi" });
    await addFortuneStamp({ date: "2026-10-01", fortune: "daikichi" });
    await addFortuneStamp({ date: "2026-10-02", fortune: "kyo" });
    expect(await fortuneStamps()).toEqual([
      { date: "2026-10-01", fortune: "kichi" },
      { date: "2026-10-02", fortune: "kyo" },
    ]);
  });
});
