import { describe, expect, it } from "vitest";
import { SCENERIES } from "../data/scenery";
import { getCurriculum } from "./curriculum";
import { BAND_MAX, GROUND, SKY_MAX, SKY_MIN, groundScene, project, sampleTracks, skyHeight, skyMarkPoses, skyMarks } from "./horizon";
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

describe("la bande d'horizon", () => {
  it("le panorama se replie au défilement, sans descendre sous la bande repliée", () => {
    expect(skyHeight(-50)).toBe(SKY_MAX);
    expect(skyHeight(0)).toBe(SKY_MAX);
    expect(skyHeight(100)).toBe(SKY_MAX - 100);
    expect(skyHeight(10_000)).toBe(SKY_MIN);
    expect(BAND_MAX).toBe(SKY_MAX + GROUND);
  });

  it("projette sans couture : identité sous le raccord, échelle 1 au raccord, puis f décroît", () => {
    const cB = 1000;
    const skyH = SKY_MIN;
    expect(project(100, 1200, cB, skyH, 390)).toEqual({ x: 100, y: skyH + GROUND + 200, f: 1 });
    const at = project(100, cB, cB, skyH, 390);
    expect(at.f).toBe(1);
    expect(at.y).toBe(skyH + GROUND);
    // Juste au-dessus du raccord, le sol a encore l'échelle du plat (dérivée 1).
    const just = project(100, cB - 1, cB, skyH, 390);
    expect(skyH + GROUND - just.y).toBeCloseTo(1, 1);
    let prev = at;
    for (const d of [50, 150, 400, 1000, 3000]) {
      const p = project(100, cB - d, cB, skyH, 390);
      expect(p.f).toBeLessThan(prev.f);
      expect(p.y).toBeLessThan(prev.y);
      expect(p.y).toBeGreaterThan(skyH);
      // La largeur se resserre vers le centre.
      expect(Math.abs(p.x - 195)).toBeLessThan(Math.abs(prev.x - 195));
      prev = p;
    }
  });

  it("le tracé échantillonné garde la longueur exacte de la route", () => {
    const layout = realLayout();
    const tracks = sampleTracks(layout.paths);
    for (const [i, t] of tracks.entries()) {
      expect(t.pts.at(-1)!.d).toBeCloseTo(layout.paths[i].length, 3);
      for (let k = 1; k < t.pts.length; k++) expect(t.pts[k].d).toBeGreaterThanOrEqual(t.pts[k - 1].d);
    }
  });

  it("le sol montre la voie passée sous la bande, ses arrêts couchés et rien au-delà de la profondeur", () => {
    const layout = realLayout();
    const tracks = sampleTracks(layout.paths);
    const cB = 3000;
    const scene = groundScene(layout, tracks, undefined, cB, SKY_MIN);
    expect(scene.tracks.length).toBeGreaterThan(0);
    expect(scene.tracks[0].ballast).toMatch(/^M/);
    expect(scene.nodes.length).toBeGreaterThan(2);
    for (const g of scene.nodes) {
      expect(g.ry).toBeLessThanOrEqual(g.rx + 1e-9);
      expect(g.y).toBeGreaterThanOrEqual(SKY_MIN);
      // Les libellés s'effacent avant les kanji, eux-mêmes avant les disques.
      if (g.label) expect(g.f).toBeGreaterThan(0.8);
    }
    const far = groundScene(layout, tracks, undefined, cB, SKY_MIN).nodes.filter((g) => g.node.y < cB - 14 * GROUND);
    expect(far).toHaveLength(0);
  });
});

describe("les repères du ciel", () => {
  it("chaque ville-étape ou ville unique du Tōkaidō a un repère, pas les villages", () => {
    const layout = realLayout();
    const marks = skyMarks(layout, SCENERIES);
    const cities = layout.nodes.filter((n) => n.kind === "city");
    expect(marks.length).toBeGreaterThan(20);
    expect(marks.length).toBeLessThanOrEqual(cities.length);
    const edo = marks.find((m) => m.name.startsWith("日本橋"));
    expect(edo?.kind).toBe("bridge");
  });

  it("grandit quand sa ville monte vers le tiers haut, puis rapetisse vers l'horizon", () => {
    const mark = { id: "c", y: 2000, kind: "castle" as const, name: "x", side: 1 as const };
    const visible = 480;
    const size = (cB: number) => skyMarkPoses([mark], cB, visible, SKY_MIN, 390)[0]?.w ?? 0;
    // La ville est sous l'écran : pas encore de repère.
    expect(size(2000 - visible - 10)).toBe(0);
    const entering = size(2000 - visible + 40);
    const peak = size(2000 - visible / 3);
    const leaving = size(2000 + 200);
    expect(entering).toBeGreaterThan(0);
    expect(peak).toBeGreaterThan(entering);
    expect(leaving).toBeLessThan(peak);
    expect(size(2000 + 2000)).toBe(0);
  });
});
