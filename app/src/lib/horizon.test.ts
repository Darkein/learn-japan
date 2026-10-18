import { describe, expect, it } from "vitest";
import { SCENERIES } from "../data/scenery";
import { getCurriculum } from "./curriculum";
import { biomeAt, biomeTrack, driftItems, markRaised, SKY_MAX, SKY_MIN, skyHeight, skyMarks } from "./horizon";
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
      expect(m.x).toBeGreaterThan(0.15);
      expect(m.x).toBeLessThan(0.85);
    }
  });

  it("deux villes qui se suivent lèvent leur repère de côtés opposés", () => {
    const marks = skyMarks(realLayout(), SCENERIES);
    for (let i = 1; i < marks.length; i++) {
      const a = marks[i - 1];
      const b = marks[i];
      if (b.y - a.y < 900) expect(a.x < 0.5).not.toBe(b.x < 0.5);
    }
  });

  it("un repère est levé tant que sa ville est sur la voie visible", () => {
    const mark = { id: "c", y: 2000, kind: "castle" as const, name: "x", x: 0.3 };
    expect(markRaised(mark, 2100, 2600)).toBe(false);
    expect(markRaised(mark, 1500, 2100)).toBe(true);
    expect(markRaised(mark, 1200, 1900)).toBe(false);
  });
});

describe("le décor qui défile", () => {
  const plain = () => "rice" as const;

  it("glisse plus vite au plan proche qu'au plan moyen, et reste stable", () => {
    const at = (layer: "mid" | "near", pos: number) => driftItems(layer, pos, 390, 0, plain);
    for (const layer of ["mid", "near"] as const) {
      const a = at(layer, 1000);
      const b = at(layer, 1100);
      const common = a.find((it) => b.some((j) => j.key === it.key))!;
      const moved = b.find((j) => j.key === common.key)!.x - common.x;
      expect(moved).toBeCloseTo(layer === "mid" ? 22 : 55, 5);
      expect(at(layer, 1000)).toEqual(a);
    }
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
