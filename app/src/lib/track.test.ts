import { describe, expect, it } from "vitest";
import { PATH_STEPS, stepNumberBases, type PathStep } from "./path";
import { layoutTrack, pathD, segmentLength, TRAIN_LENGTH, type TrackInput, type TrackLesson, type TrackRoute } from "./track";

const ALL = PATH_STEPS;

function lesson(id: string, level: number, number: number, opts: Partial<TrackLesson> = {}): TrackLesson {
  return { id, level, number, title: id, steps: ALL, stepsDone: [], completed: false, open: false, ...opts };
}

function route(level: number, n: number): TrackRoute {
  return {
    level,
    cities: Array.from({ length: n + 1 }, (_, i) => ({
      index: i,
      kanji: `駅${i}`,
      romaji: `c${i}`,
      size: i === 0 || i === n ? ("terminus" as const) : ("ville" as const),
    })),
  };
}

function input(lessons: TrackLesson[], extra: Partial<TrackInput> = {}): TrackInput {
  return {
    width: 390,
    lessons,
    routes: [route(5, 3), route(4, 2)],
    stamps: {},
    bases: stepNumberBases(lessons.map((l) => ({ id: l.id, introduces: { vocab: ["v"], grammar: ["g"] } }))),
    ...extra,
  };
}

const N5 = [lesson("a", 5, 1, { completed: true, open: true }), lesson("b", 5, 2, { open: true, stepsDone: ["course", "vocab"] }), lesson("c", 5, 3)];

describe("layoutTrack", () => {
  it("numérote les étapes sur tout le curriculum et place les villes après leur étape", () => {
    const t = layoutTrack(input(N5, { current: { kind: "step", lessonId: "b", step: "grammar" }, stamps: { 5: 1 } }));
    const steps = t.nodes.filter((n) => n.kind === "step");
    expect(steps[0]).toMatchObject({ number: 1, state: "done" });
    expect(steps.find((n) => n.kind === "step" && n.lessonId === "b" && n.step === "course")).toMatchObject({ number: 8 });
    // 21 étapes, 3 tronçons : la ville 1 tombe après l'étape 7 (le contrôle de « a »).
    const ids = t.nodes.filter((n) => n.level === 5).map((n) => n.id);
    expect(ids[0]).toBe("city:5:0");
    expect(ids[ids.indexOf("a:exam") + 1]).toBe("city:5:1");
    expect(ids[ids.length - 1]).toBe("city:5:3");
    const c1 = t.nodes.find((n) => n.id === "city:5:1");
    expect(c1).toMatchObject({ passed: true, next: false });
    expect(t.nodes.find((n) => n.id === "city:5:2")).toMatchObject({ passed: false, next: true });
  });

  it("descend toujours et reste dans la largeur", () => {
    const t = layoutTrack(input(N5));
    const r5 = t.nodes.filter((n) => n.level === 5);
    for (let i = 1; i < r5.length; i++) expect(r5[i].y).toBeGreaterThan(r5[i - 1].y);
    for (const n of t.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(16);
      expect(n.x + n.r).toBeLessThanOrEqual(390 - 16);
    }
  });

  it("l'étape à faire porte la bulle, et le train s'arrête juste avant elle", () => {
    const t = layoutTrack(input(N5, { current: { kind: "step", lessonId: "b", step: "grammar" } }));
    const cur = t.current!;
    expect(cur).toMatchObject({ kind: "step", step: "grammar", state: "cur" });
    expect(t.nodes.filter((n) => (n.kind === "step" || n.kind === "extra") && n.state === "cur")).toHaveLength(1);
    expect(t.train!.dist).toBeLessThan(cur.dist - cur.r);
    const prev = t.nodes[t.nodes.indexOf(cur) - 1];
    expect(t.train!.dist - TRAIN_LENGTH / 2).toBeGreaterThan(prev.dist);
    expect(t.paths[0].painted).toBeCloseTo(t.train!.dist + TRAIN_LENGTH / 2);
    expect(t.bubble).toBeDefined();
    expect(t.keepOut).toContainEqual(t.bubble);
  });

  it("une révision insérée se place devant l'étape, sans numéro", () => {
    const t = layoutTrack(input(N5, { current: { kind: "inserted-review", lessonId: "b", step: "grammar" } }));
    const i = t.nodes.findIndex((n) => n.kind === "extra" && n.extra === "inserted-review");
    expect(t.nodes[i]).toMatchObject({ state: "cur" });
    expect(t.nodes[i + 1]).toMatchObject({ kind: "step", step: "grammar", state: "todo", number: 10 });
  });

  it("une station de repos suit chaque 5ᵉ leçon, entre le contrôle et le cours suivant", () => {
    const six = Array.from({ length: 6 }, (_, i) => lesson(`l${i}`, 5, i + 1, { completed: i < 5, open: i <= 5, restDone: false }));
    const t = layoutTrack(input(six, { current: { kind: "rest", lessonId: "l4" } }));
    const ids = t.nodes.map((n) => n.id);
    const rest = ids.indexOf("rest:l4");
    expect(rest).toBeGreaterThan(ids.indexOf("l4:exam"));
    expect(rest).toBeLessThan(ids.indexOf("l5:course"));
    expect(t.current?.id).toBe("rest:l4");
    expect(ids.filter((id) => id.startsWith("rest:"))).toHaveLength(1);
  });

  it("au changement de niveau : butoir, fin de route, puis la nouvelle route depuis son départ", () => {
    const all = [...N5.map((l) => ({ ...l, completed: true, open: true })), lesson("d", 4, 4, { open: true })];
    const t = layoutTrack(input(all, { current: { kind: "step", lessonId: "d", step: "course" }, stamps: { 5: 3 } }));
    expect(t.paths.map((p) => p.level)).toEqual([5, 4]);
    expect(t.paths[0]).toMatchObject({ buffer: true });
    expect(t.paths[0].painted).toBe(t.paths[0].length);
    const end = t.markers.find((m) => m.kind === "route-end");
    expect(end).toMatchObject({ level: 5, nextLevel: 4, reached: true });
    const n4 = t.nodes.filter((n) => n.level === 4);
    expect(n4[0].id).toBe("city:4:0");
    expect(n4[0].y).toBeGreaterThan(end!.y);
    // La numérotation continue : « d » commence à la n° 22.
    expect(n4[1]).toMatchObject({ kind: "step", number: 22 });
    expect(t.markers[t.markers.length - 1].kind).toBe("curriculum-end");
  });

  it("les sections de leçon couvrent la voie sans trou", () => {
    const t = layoutTrack(input(N5));
    expect(t.sections.map((s) => s.lessonId)).toEqual(["a", "b", "c"]);
    for (let i = 1; i < t.sections.length; i++) expect(t.sections[i].y0).toBe(t.sections[i - 1].y1);
    expect(t.sections[2].y1).toBeLessThanOrEqual(t.height);
  });

  it("une leçon pas encore ouverte est atténuée", () => {
    const t = layoutTrack(input(N5));
    expect(t.nodes.find((n) => n.id === "c:course")).toMatchObject({ dim: true });
    expect(t.nodes.find((n) => n.id === "b:course")).toMatchObject({ dim: false });
  });

  it("le tracé SVG relie tous les points, distances cohérentes", () => {
    const t = layoutTrack(input(N5));
    const p = t.paths[0];
    const d = pathD(p);
    expect(d.startsWith("M")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(p.points.length - 1);
    expect(p.dists[1]).toBeCloseTo(segmentLength(p.points[0], p.points[1]));
    // Un segment courbe est plus long que la ligne droite, et pas démesurément.
    const [a, b] = [p.points[1], p.points[2]];
    const straight = Math.hypot(b.x - a.x, b.y - a.y);
    expect(segmentLength(a, b)).toBeGreaterThanOrEqual(straight - 0.01);
    expect(segmentLength(a, b)).toBeLessThan(straight * 1.3);
  });

  it("sur un petit écran l'amplitude se resserre", () => {
    const t = layoutTrack(input(N5, { width: 320 }));
    for (const n of t.nodes) expect(n.x + n.r).toBeLessThanOrEqual(320 - 16);
  });
});

describe("révision libre au bout du curriculum", () => {
  it("un nœud non numéroté dans la zone de fin", () => {
    const done = N5.map((l) => ({ ...l, completed: true, open: true }));
    const t = layoutTrack(input(done, { current: { kind: "free-review" }, stamps: { 5: 3 } }));
    expect(t.current).toMatchObject({ kind: "extra", extra: "free-review" });
    expect(t.train).toBeUndefined();
    const steps: PathStep[] = t.nodes.filter((n) => n.kind === "step").map((n) => (n.kind === "step" ? n.step : "course"));
    expect(steps).toHaveLength(21);
  });
});
