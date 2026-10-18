import { describe, expect, it } from "vitest";
import { getCurriculum } from "./curriculum";
import { lessonSteps } from "./path";
import { inkBox, placeDecor, seasonOf, type CityScenery, type DecorItem, type RouteScenery } from "./scenery";
import { layoutTrack, samplePath, type Box, type TrackLayout } from "./track";
import { trackInput, type TrackLessonSource } from "./trackInput";

function realLayout(sceneries: RouteScenery[]): TrackLayout {
  const all: TrackLessonSource[] = getCurriculum().map((e) => ({
    id: e.id, level: e.level, order: e.order, title: e.title, introduces: e.introduces,
    steps: lessonSteps(e), stepsDone: [], locked: false,
  }));
  return layoutTrack(trackInput({ width: 390, lessons: all, stamps: {}, restDone: new Set(), sceneries }));
}

/** Un Tōkaidō d'essai : paysages variés, repères, une traversée de chaque sorte, Kanbara et Shōno. */
function testScenery(): RouteScenery {
  const cities: CityScenery[] = Array.from({ length: 55 }, () => ({ kana: "" }));
  const set = (i: number, c: Partial<CityScenery>) => (cities[i] = { ...cities[i], ...c });
  set(0, { marks: [{ kind: "bridge" }] });
  set(1, { biome: "town" });
  set(5, { biome: "coast" });
  set(7, { crossing: "bridge" });
  set(9, { biome: "mountain", relief: "pass" });
  set(10, { biome: "lake", marks: [{ kind: "torii" }, { kind: "shrine" }] });
  set(13, { unique: "fuji-hara" });
  set(14, { marks: [{ kind: "fuji", far: true }] });
  set(15, { forced: "snow" });
  set(20, { biome: "tea" });
  set(24, { biome: "river", crossing: "ford", unique: "oi-ford" });
  set(42, { crossing: "ferry" });
  set(45, { forced: "rain" });
  return { level: 5, cities };
}
const TEST_SCENERY = testScenery();

const LAYOUT = realLayout([TEST_SCENERY]);

function boxOf(it: DecorItem): Box {
  return inkBox(it);
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("seasonOf", () => {
  it("suit le calendrier réel", () => {
    expect(seasonOf(new Date(2026, 2, 19))).toBe("none");
    expect(seasonOf(new Date(2026, 2, 20))).toBe("spring");
    expect(seasonOf(new Date(2026, 3, 30))).toBe("spring");
    expect(seasonOf(new Date(2026, 4, 1))).toBe("none");
    expect(seasonOf(new Date(2026, 5, 15))).toBe("rainy");
    expect(seasonOf(new Date(2026, 7, 31))).toBe("summer");
    expect(seasonOf(new Date(2026, 8, 15))).toBe("none");
    expect(seasonOf(new Date(2026, 9, 1))).toBe("autumn");
    expect(seasonOf(new Date(2026, 11, 1))).toBe("winter");
    expect(seasonOf(new Date(2027, 1, 28))).toBe("winter");
  });
});

describe("placeDecor", () => {
  const decor = placeDecor(LAYOUT, [TEST_SCENERY], "none");
  const near = decor.items.filter((i) => !i.far);

  it("ne couvre jamais un arrêt, un libellé, la bulle ni un autre élément", () => {
    expect(near.length).toBeGreaterThan(200);
    for (const it of near) {
      const b = boxOf(it);
      for (const k of LAYOUT.keepOut) if (overlaps(b, k)) throw new Error(`${it.kind} à ${Math.round(it.y)} couvre une zone interdite`);
    }
    const sorted = near.map(boxOf).sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && sorted[j].y < sorted[i].y + sorted[i].h; j++) {
        expect(overlaps(sorted[i], sorted[j])).toBe(false);
      }
    }
  });

  it("se tient à distance des rails", () => {
    const samples = LAYOUT.paths.flatMap((p) => samplePath(p, 24));
    for (const it of near) {
      const b = boxOf(it);
      const hit = samples.find((p) => p.x > b.x - 12 && p.x < b.x + b.w + 12 && p.y > b.y - 12 && p.y < b.y + b.h + 12);
      if (hit) throw new Error(`${it.kind} à ${Math.round(it.y)} touche les rails`);
    }
  });

  it("reste dans la largeur, à peine rogné au bord", () => {
    for (const it of near) {
      expect(it.x).toBeGreaterThanOrEqual(-120 * it.scale * 0.15 - 0.01);
      expect(it.x + 120 * it.scale).toBeLessThanOrEqual(390 + 120 * it.scale * 0.15 + 0.01);
    }
  });

  it("est stable d'une visite à l'autre", () => {
    expect(placeDecor(LAYOUT, [TEST_SCENERY], "none")).toEqual(decor);
  });

  it("pose les repères, les traversées et les exceptions de la route", () => {
    const city = (i: number) => LAYOUT.nodes.find((n) => n.id === `city:5:${i}`)!;
    const torii = near.find((i) => i.kind === "torii")!;
    expect(Math.abs(torii.y - city(10).y)).toBeLessThan(200);
    const fuji = decor.items.find((i) => i.kind === "fuji")!;
    expect(fuji.far).toBe(true);
    expect(fuji.y).toBeLessThan(city(14).y);
    expect(decor.crossings.map((c) => c.type)).toEqual(["bridge", "ford", "ferry"]);
    // Les illustrations uniques ont leur place, que rien d'autre ne touche.
    expect(decor.uniques.map((u) => u.kind)).toEqual(["fuji-hara", "oi-ford"]);
    for (const u of decor.uniques) for (const it of near) expect(overlaps(boxOf(it), u.box)).toBe(false);
    for (const c of decor.crossings) {
      // La bande d'eau tient dans son tronçon, loin des nœuds et de leurs libellés.
      for (const n of LAYOUT.nodes) expect(Math.abs(n.y - c.y)).toBeGreaterThanOrEqual(n.r + 40);
    }
    expect(decor.items.some((i) => i.kind === "rain" && Math.abs(i.y + 120 - city(45).y) < 1)).toBe(true);
    // Kanbara sous la neige, même hors de l'hiver ; ailleurs, pas de neige.
    const around15 = near.filter((i) => i.snowy);
    expect(around15.length).toBeGreaterThan(0);
    for (const i of around15) expect(i.y).toBeLessThan(city(15).y + 200);
  });

  it("met une borne-lieue toutes les 4 étapes", () => {
    const steps = LAYOUT.nodes.filter((n) => n.kind === "step").length;
    const bornes = near.filter((i) => i.kind === "ichirizuka").length;
    expect(bornes).toBeGreaterThan(steps / 4 * 0.8);
    expect(bornes).toBeLessThanOrEqual(steps / 4);
  });

  it("remplit chaque tronçon d'un à deux éléments par écran de chaque côté", () => {
    const fill = near.filter((i) => i.kind !== "ichirizuka");
    const screens = LAYOUT.height / 700;
    expect(fill.length / screens).toBeGreaterThan(1.5);
    expect(fill.length / screens).toBeLessThan(5);
  });

  it("suit la saison", () => {
    const plain = realLayout([]);
    const kinds = (s: Parameters<typeof placeDecor>[2]) => new Set(placeDecor(plain, [], s).items.map((i) => i.kind));
    expect(kinds("spring").has("sakura")).toBe(true);
    expect(kinds("autumn").has("maple")).toBe(true);
    expect(kinds("rainy").has("hydrangea")).toBe(true);
    const none = kinds("none");
    expect(none.has("sakura") || none.has("maple") || none.has("hydrangea")).toBe(false);
    expect(placeDecor(plain, [], "winter").items.every((i) => i.snowy)).toBe(true);
  });

  it("se calcule vite sur tout le curriculum", () => {
    const t0 = performance.now();
    placeDecor(LAYOUT, [TEST_SCENERY], "spring");
    expect(performance.now() - t0).toBeLessThan(150);
  });
});
