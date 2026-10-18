import { describe, expect, it } from "vitest";
import type { FlowActivity } from "./flow";
import { PATH_STEPS } from "./path";
import { trackCurrent, trackInput, trackRoutes, type TrackLessonSource } from "./trackInput";

function src(id: string, order: number, opts: Partial<TrackLessonSource> = {}): TrackLessonSource {
  return {
    id, level: 5, order, title: id,
    introduces: { vocab: ["v"], grammar: ["g"] },
    steps: PATH_STEPS, stepsDone: [], locked: false, ...opts,
  };
}

const lessons = [
  src("a", 1, { completedAt: 1, startedAt: 1, stepsDone: PATH_STEPS }),
  src("b", 2, { startedAt: 2, stepsDone: ["course", "vocab"] }),
  src("c", 3, { locked: true }),
];

describe("trackCurrent", () => {
  it("traduit chaque activité du flux en nœud de la voie", () => {
    const step = { kind: "grammar", lessonId: "b", step: "grammar", title: "", reason: "" } as const;
    expect(trackCurrent(step, lessons)).toEqual({ kind: "step", lessonId: "b", step: "grammar" });
    const reviewStep = { kind: "review", lessonId: "b", step: "review", title: "", reason: "" } as const;
    expect(trackCurrent(reviewStep, lessons)).toEqual({ kind: "step", lessonId: "b", step: "review" });
    const inserted = { kind: "review", lessonId: "b", title: "", reason: "" } as const;
    expect(trackCurrent(inserted, lessons)).toEqual({ kind: "inserted-review", lessonId: "b", step: "grammar" });
    const targeted: FlowActivity = { kind: "review", lessonId: "b", itemIds: ["x"], title: "", reason: "" };
    expect(trackCurrent(targeted, lessons)).toMatchObject({ kind: "targeted-review" });
    expect(trackCurrent({ kind: "review", title: "", reason: "" }, lessons)).toEqual({ kind: "free-review" });
    expect(trackCurrent({ kind: "rest", lessonIds: ["a"], title: "", reason: "" }, lessons)).toEqual({ kind: "rest", lessonId: "a" });
    const next = { kind: "lesson", lessonId: "c", refId: "c", step: "course", title: "", reason: "" } as const;
    expect(trackCurrent(next, lessons)).toEqual({ kind: "step", lessonId: "c", step: "course" });
    expect(trackCurrent({ kind: "done", title: "", reason: "" }, lessons)).toBeUndefined();
  });
});

describe("trackInput", () => {
  it("ouvre les leçons commencées et la prochaine, numérote dans le curriculum", () => {
    const t = trackInput({ width: 390, lessons, stamps: {}, restDone: new Set() });
    expect(t.lessons.map((l) => [l.id, l.completed, l.open])).toEqual([
      ["a", true, true],
      ["b", false, true],
      ["c", false, false],
    ]);
    expect(t.bases.get("b")).toBe(7);
  });
});

describe("trackRoutes", () => {
  it("le départ et le terminus sont des terminus, les jalons de grandes villes", () => {
    const tokaido = trackRoutes().find((r) => r.level === 5)!;
    expect(tokaido.cities[0].size).toBe("terminus");
    expect(tokaido.cities[54].size).toBe("terminus");
    expect(tokaido.cities[19].size).toBe("grande"); // Fuchū (Shizuoka)
    expect(tokaido.cities[4].size).toBe("ville");
    const custom = trackRoutes((lv, i) => (lv === 5 && i === 4 ? "village" : undefined));
    expect(custom.find((r) => r.level === 5)!.cities[4].size).toBe("village");
  });
});

describe("la vraie voie", () => {
  it("se calcule en entier, vite, sur tout le curriculum", async () => {
    const { getCurriculum } = await import("./curriculum");
    const { lessonSteps } = await import("./path");
    const { layoutTrack } = await import("./track");
    const all: TrackLessonSource[] = getCurriculum().map((e) => ({
      id: e.id, level: e.level, order: e.order, title: e.title, introduces: e.introduces,
      steps: lessonSteps(e), stepsDone: [], locked: false,
    }));
    const t0 = performance.now();
    const t = layoutTrack(trackInput({ width: 390, lessons: all, stamps: {}, restDone: new Set() }));
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    // Chaque route du curriculum a son tracé ; toutes ses villes sont posées.
    for (const p of t.paths) {
      const route = trackRoutes().find((r) => r.level === p.level)!;
      expect(t.nodes.filter((n) => n.kind === "city" && n.level === p.level)).toHaveLength(route.cities.length);
    }
    const steps = t.nodes.filter((n) => n.kind === "step");
    expect(steps).toHaveLength(all.reduce((n, l) => n + l.steps.length, 0));
    expect(steps[steps.length - 1].kind === "step" && steps[steps.length - 1].number).toBe(steps.length);
  });
});
