import { describe, expect, it } from "vitest";
import { SCENERIES } from "../data/scenery";
import { getCurriculum } from "./curriculum";
import {
  biomeAt, biomeTrack, BIRDS_MARGIN, BIRDS_SPEED, birdsShift, driftItems, FAR_MARK_SPEED, groundDepth, MARK_SPEED, markRaised, markX, RIDGE_PERIOD, RIDGE_SPEED, ridgePath, SKY_MAX, SKY_MIN,
  skyHeight, skyMarks,
} from "./horizon";
import { lessonSteps } from "./path";
import { layoutTrack, type TrackLayout } from "./track";
import { trackInput, type TrackLessonSource } from "./trackInput";

function realLayout(): TrackLayout {
  const all: TrackLessonSource[] = getCurriculum().map((e) => ({
    id: e.id, level: e.level, order: e.order, title: e.title, introduces: e.introduces,
    steps: lessonSteps(e), stepsDone: [], locked: false,
  }));
  return layoutTrack(trackInput({ width: 390, lessons: all, stamps: {}, restDone: new Set(), sceneries: SCENERIES }));
}

describe("la bande de ciel", () => {
  it("le panorama se replie au défilement, sans descendre sous la bande repliée", () => {
    expect(skyHeight(-50)).toBe(SKY_MAX);
    expect(skyHeight(0)).toBe(SKY_MAX);
    expect(skyHeight(100)).toBe(SKY_MAX - 100);
    expect(skyHeight(10_000)).toBe(SKY_MIN);
  });

  it("le sol prend 40 % de la bande, entre 50 et 112 px", () => {
    expect(groundDepth(SKY_MIN)).toBe(50);
    expect(groundDepth(200)).toBe(80);
    expect(groundDepth(SKY_MAX)).toBe(112);
  });
});

describe("les repères du ciel", () => {
  it("chaque ville-étape ou ville unique a un repère à sa place, pas les villages", () => {
    const layout = realLayout();
    const marks = skyMarks(layout, SCENERIES);
    const cities = layout.nodes.filter((n) => n.kind === "city");
    expect(marks.length).toBeGreaterThan(20);
    expect(marks.length).toBeLessThan(cities.length);
    expect(marks.find((m) => m.name.startsWith("日本橋"))?.kind).toBe("bridge");
    for (const m of marks) {
      expect(m.x).toBeGreaterThan(0.4);
      expect(m.x).toBeLessThan(0.7);
    }
  });

  it("une illustration unique a son repère, à la place de son dessin et sous le nom de son lieu", () => {
    const layout = realLayout();
    const lake = skyMarks(layout, SCENERIES).find((m) => m.name === "芦ノ湖 · lac Ashi");
    expect(lake?.kind).toBe("lake-torii");
    const band = layout.reserved.find((b) => `city:${b.level}:${b.city}` === lake?.id);
    expect(lake?.y).toBe(band!.art.y + band!.art.h / 2);
  });

  it("un repère qui est un mont glisse au fond, plus lentement que les autres", () => {
    const marks = skyMarks(realLayout(), SCENERIES);
    expect(marks.find((m) => m.kind === "fuji")?.depth).toBe("far");
    expect(marks.find((m) => m.kind === "castle")?.depth).toBe("mid");
    const far = { id: "f", y: 2000, kind: "fuji" as const, name: "x", x: 0.5, depth: "far" as const };
    const near = { ...far, depth: "mid" as const };
    const moved = (m: typeof far | typeof near) => markX(m, 2100, 590, 390) - markX(m, 2000, 590, 390);
    expect(moved(far)).toBeCloseTo(100 * FAR_MARK_SPEED);
    expect(moved(far)).toBeLessThan(moved(near));
  });

  it("un repère glisse avec le défilement, à sa place quand sa ville est au milieu, et reste à l'écran", () => {
    const mark = { id: "c", y: 2000, kind: "castle" as const, name: "x", x: 0.5 };
    const visible = 590;
    expect(markX(mark, 2000 - visible / 2, visible, 390)).toBeCloseTo(195);
    expect(markX(mark, 2100, visible, 390) - markX(mark, 2000, visible, 390)).toBeCloseTo(100 * MARK_SPEED);
    // Tant que son nom est affiché (sa ville sur la voie visible), son centre reste dans la bande.
    for (const m of skyMarks(realLayout(), SCENERIES).slice(0, 40)) {
      for (const pos of [m.y - visible, m.y]) {
        const x = markX(m, pos, visible, 390);
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(390);
      }
    }
  });

  it("un repère est levé tant que sa ville est sous la fenêtre, sur la voie visible", () => {
    const mark = { id: "c", y: 2000, kind: "castle" as const, name: "x", x: 0.3 };
    expect(markRaised(mark, 2001, 2600)).toBe(false);
    expect(markRaised(mark, 1500, 2100)).toBe(true);
    expect(markRaised(mark, 1200, 1999)).toBe(false);
    // Sa place est au milieu (top = 1700) : il paraît et s'efface à 300 px de part et d'autre.
    const at = (top: number) => markRaised(mark, top, top + 600);
    expect([at(1400), at(1399), at(2000), at(2001)]).toEqual([true, false, true, false]);
  });
});

describe("le décor qui défile", () => {
  const plain = () => "rice" as const;

  it("glisse d'autant plus vite que le plan est proche, et reste stable", () => {
    const at = (layer: "far" | "mid" | "near", pos: number) => driftItems(layer, pos, 390, 0, plain);
    for (const layer of ["far", "mid", "near"] as const) {
      const a = at(layer, 1000);
      const b = at(layer, 1100);
      const common = a.find((it) => b.some((j) => j.key === it.key))!;
      const moved = b.find((j) => j.key === common.key)!.x - common.x;
      expect(moved).toBeCloseTo({ far: 14, mid: 22, near: 42 }[layer], 5);
      expect(at(layer, 1000)).toEqual(a);
    }
  });

  it("pose chaque chose sur le plan de sa taille : les monts au fond, les forêts au milieu", () => {
    const kinds = (layer: "far" | "mid", biome: "mountain" | "forest") =>
      new Set(driftItems(layer, 5000, 390, 0, () => biome).map((it) => it.kind));
    for (const k of kinds("far", "mountain")) expect(["peak", "hill"]).toContain(k);
    for (const k of kinds("mid", "forest")) expect(["peak", "hill"]).not.toContain(k);
  });

  it("tire ses silhouettes du paysage du tronçon", () => {
    const layout = realLayout();
    const track = biomeTrack(layout, SCENERIES);
    expect(track.length).toBeGreaterThan(50);
    expect(biomeAt(track, -100)).toBe(track[0].biome);
    const coast = driftItems("near", 5000, 390, 0, () => "coast");
    expect(coast.length).toBeGreaterThan(3);
    for (const it of coast) expect(["boat", "pine"]).toContain(it.kind);
    const town = driftItems("near", 5000, 390, 0, () => "town");
    for (const it of town) expect(["house", "temple"]).toContain(it.kind);
  });
});

describe("les oiseaux", () => {
  it("glissent avec le plan moyen au défilement, et font le tour de la vitre sans saut", () => {
    const span = 390 + 2 * BIRDS_MARGIN;
    expect(birdsShift(100, 390) - birdsShift(0, 390)).toBeCloseTo(100 * BIRDS_SPEED);
    for (const pos of [-3000, -1, 0, 777, 12_345]) {
      const x = birdsShift(pos, 390);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(span);
    }
    expect(birdsShift(span / BIRDS_SPEED, 390)).toBeCloseTo(0);
  });
});

describe("la crête lointaine", () => {
  it("glisse lentement, d'un motif qui se répète sans couture", () => {
    const xs = (d: string) => [...d.matchAll(/L(-?[\d.]+) 4(?!\d)/g)].map((m) => Number(m[1]));
    const peak = (pos: number) => xs(ridgePath(pos, 390));
    expect(peak(100)[0] - peak(0)[0]).toBeCloseTo(100 * RIDGE_SPEED, 1);
    expect(ridgePath(RIDGE_PERIOD / RIDGE_SPEED, 390)).toBe(ridgePath(0, 390));
    expect(ridgePath(-500, 390)).toMatch(/^M-?[\d.]+ 40/);
  });
});
