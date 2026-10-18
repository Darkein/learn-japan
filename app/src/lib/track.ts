// La voie de l'accueil (SPEC §5c.2) : mise en page PURE de tout le voyage, du départ de la
// première route à la dernière leçon du curriculum. Aucun IO, aucun DOM : l'écran (ui/Track*)
// ne fait que dessiner ce que ce module place.
//
// La voie est calculée en entier (quelques centaines de nœuds, une fraction de milliseconde) :
// une leçon garde sa place quoi qu'on charge au-dessus ou au-dessous, et l'écran n'en rend que
// la tranche visible. Une route = un tracé continu ; au changement de niveau, le tracé
// s'arrête sur un butoir et le suivant repart de la ville de départ de la nouvelle route.

import type { PathStep } from "./path";
import { stationStep } from "./tokaido";

/** Ce que la voie attend d'une leçon — sous-ensemble de lessons.ts `Lesson`. */
export interface TrackLesson {
  id: string;
  level: number;
  /** Numéro affiché (« Leçon 12 »). */
  number: number;
  title: string;
  steps: PathStep[];
  stepsDone: PathStep[];
  completed: boolean;
  /** Ouverte : commencée, ou prochaine à commencer. Une leçon fermée est atténuée. */
  open: boolean;
  /** Station de repos qui SUIT cette leçon déjà faite (meta `rest.<id>`). */
  restDone?: boolean;
}

export type CitySize = "village" | "ville" | "grande" | "terminus";

/** Motif d'un tampon de ville (SPEC §5c.5) : le repère principal de la ville. */
export type StampMotif =
  | "castle" | "bridge" | "mountain" | "fuji" | "wave" | "temple" | "shrine" | "lake"
  | "rice" | "pine" | "town" | "boat" | "gate" | "tea" | "pagoda";

export interface TrackCity {
  index: number;
  kanji: string;
  romaji: string;
  size: CitySize;
  /** Kanji propre au cœur du nœud (sinon celui de sa taille, ui/track/words.ts). */
  glyph?: string;
  /** Lecture en kana du nom. */
  kana?: string;
  /** Motif du tampon (sinon celui de sa taille). */
  motif?: StampMotif;
}

export interface TrackRoute {
  level: number;
  /** Villes 0..S, dans l'ordre. La 0 est le départ, la S le terminus. */
  cities: TrackCity[];
}

/** Ce qui est À FAIRE maintenant (`pickNext`), traduit en nœud de la voie. */
export type TrackCurrent =
  | { kind: "step"; lessonId: string; step: PathStep }
  /** Révision insérée devant l'étape `step` (§5.4), ou ciblée devant le rattrapage. */
  | { kind: "inserted-review" | "targeted-review"; lessonId: string; step: PathStep }
  /** Station de repos, après la leçon `lessonId`. */
  | { kind: "rest"; lessonId: string }
  /** Révision libre, au bout du curriculum. */
  | { kind: "free-review" };

export interface TrackInput {
  width: number;
  lessons: TrackLesson[];
  routes: TrackRoute[];
  current?: TrackCurrent;
  /** Villes déjà passées par niveau (tampons, lib/tokaido.ts `stamps`). */
  stamps: Record<number, number>;
  /** Base de numérotation de chaque leçon (path.ts `stepNumberBases`). */
  bases: Map<string, number>;
}

export type NodeState = "done" | "cur" | "todo";
export type Side = "left" | "right";
export type ExtraKind = "inserted-review" | "targeted-review" | "rest" | "free-review";

interface NodeBase {
  id: string;
  level: number;
  x: number;
  y: number;
  /** Demi-taille du nœud (rayon, ou demi-côté pour le contrôle). */
  r: number;
  /** Distance le long du tracé de sa route. */
  dist: number;
  /** Côté du libellé (le décor va de l'autre). */
  side: Side;
}

export type TrackNode =
  | (NodeBase & {
      kind: "step";
      lessonId: string;
      step: PathStep;
      number: number;
      state: NodeState;
      /** Leçon pas encore ouverte : nœud atténué. */
      dim: boolean;
    })
  | (NodeBase & { kind: "extra"; extra: ExtraKind; lessonId?: string; state: NodeState; dim: boolean })
  | (NodeBase & {
      kind: "city";
      city: TrackCity;
      passed: boolean;
      next: boolean;
      /** Tampon posé à côté de la ville passée, du côté libre. */
      stamp?: Box;
    });

export type TrackMarker =
  /** Séparateur de leçon, juste au-dessus de son premier nœud. */
  | { kind: "lesson"; lessonId: string; number: number; level: number; y: number; dim: boolean }
  /** Fin de route : butoir, carte de fin, correspondance vers `nextLevel`. */
  | { kind: "route-end"; level: number; nextLevel?: number; y: number; height: number; reached: boolean }
  /** Bout du curriculum : la voie continue en pointillés. */
  | { kind: "curriculum-end"; level: number; y: number; height: number };

export interface TrackPoint {
  x: number;
  y: number;
}

export interface TrackPath {
  level: number;
  points: TrackPoint[];
  /** Distance cumulée à chaque point. */
  dists: number[];
  length: number;
  /** Le tracé finit sur un butoir (fin de route), sinon il se perd en pointillés. */
  buffer: boolean;
  /** Longueur des rails peints en vermillon (derrière le train). */
  painted: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TrackSection {
  lessonId: string;
  level: number;
  y0: number;
  y1: number;
}

export interface TrackLayout {
  width: number;
  height: number;
  nodes: TrackNode[];
  markers: TrackMarker[];
  paths: TrackPath[];
  /** Le nœud à faire, et sa bulle. */
  current?: TrackNode;
  bubble?: Box;
  /** Arrêt du train : distance du CENTRE du train sur le tracé de sa route. */
  train?: { level: number; dist: number };
  /** Zones que le décor ne doit pas couvrir (nœuds, libellés, bulle, séparateurs). */
  keepOut: Box[];
  sections: TrackSection[];
}

// ---- Gabarit ---------------------------------------------------------------------

export const TRAIN_LENGTH = 36;
const TOP = 48;
const BUBBLE_W = 218;
const BUBBLE_H = 196;
const LABEL_W = 140;
/** Écart vertical AVANT un nœud, selon ce qu'il est. */
const GAP = { step: 108, extra: 108, village: 84, ville: 96, grande: 112, terminus: 120 } as const;
const LESSON_MARK = 56;
/** Place gardée sous l'étape à faire, pour que sa bulle ne couvre pas le libellé suivant. */
const AFTER_CUR = 64;
const ROUTE_END_H = 470;
const CURRICULUM_END_H = 220;
/** Le zigzag : décalage horizontal de chaque nœud, en part de l'amplitude. */
const ZIGZAG = [0, -0.55, -0.85, -0.55, 0, 0.55, 0.85, 0.55];
const RADIUS = { village: 22, ville: 28, grande: 32, terminus: 32 } as const;
/** Côté d'un tampon de ville posé sur la voie. */
const STAMP = 62;

/** Rayon d'une étape : contrôle carré un peu plus grand, étape à faire plus grande. */
function stepRadius(step: PathStep, cur: boolean): number {
  if (step === "exam") return cur ? 40 : 36;
  return cur ? 38 : 32;
}

// ---- Géométrie ---------------------------------------------------------------------

/** Segment lissé entre deux points : tangentes verticales (le tracé descend toujours). */
function segment(a: TrackPoint, b: TrackPoint): [TrackPoint, TrackPoint, TrackPoint, TrackPoint] {
  const d = (b.y - a.y) / 2;
  return [a, { x: a.x, y: a.y + d }, { x: b.x, y: b.y - d }, b];
}

function cubicAt(p: TrackPoint[], t: number): TrackPoint {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}

/** Longueur d'un segment, par échantillonnage (précision bien meilleure que le pixel). */
export function segmentLength(a: TrackPoint, b: TrackPoint): number {
  const p = segment(a, b);
  let len = 0;
  let prev = a;
  for (let i = 1; i <= 48; i++) {
    const q = cubicAt(p, i / 48);
    len += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return len;
}

/** Le `d` SVG d'un tracé, des points `from` à `to` inclus (tout le tracé par défaut). */
export function pathD(path: TrackPath, from = 0, to = path.points.length - 1): string {
  const pts = path.points;
  if (pts.length === 0) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(pts[from].x)} ${r(pts[from].y)}`;
  for (let i = from + 1; i <= to; i++) {
    const [, c1, c2, b] = segment(pts[i - 1], pts[i]);
    d += ` C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(b.x)} ${r(b.y)}`;
  }
  return d;
}

// ---- Mise en page ------------------------------------------------------------------

/** Étapes faites d'une leçon (une leçon terminée les a toutes). */
function doneSet(l: TrackLesson): Set<PathStep> {
  return new Set(l.completed ? l.steps : l.stepsDone);
}

/** Côté du libellé : vers la place libre (loin du bord le plus proche, ou à l'opposé du virage). */
function sideFor(x: number, cx: number, nextX: number | undefined): Side {
  if (x < cx - 1) return "right";
  if (x > cx + 1) return "left";
  return nextX !== undefined && nextX > cx ? "left" : "right";
}

interface Pending {
  kind: "step" | "extra" | "city";
  gap: number;
  r: number;
  make: (base: NodeBase) => TrackNode;
}

export function layoutTrack(input: TrackInput): TrackLayout {
  const { width, lessons, routes, current, stamps, bases } = input;
  const cx = width / 2;
  const amp = Math.max(40, Math.min(110, cx - 85));
  const nodes: TrackNode[] = [];
  const markers: TrackMarker[] = [];
  const paths: TrackPath[] = [];
  const sections: TrackSection[] = [];
  let y = TOP;

  const byLevel = new Map<number, TrackLesson[]>();
  for (const l of lessons) byLevel.set(l.level, [...(byLevel.get(l.level) ?? []), l]);
  const levels = routes.map((r) => r.level).filter((lv) => byLevel.has(lv));
  const firstOpenIdx = lessons.findIndex((l) => !l.completed);

  levels.forEach((level, li) => {
    const route = routes.find((r) => r.level === level)!;
    const levelLessons = byLevel.get(level)!;
    const span = route.cities.length - 1;
    const stepsTotal = levelLessons.reduce((n, l) => n + l.steps.length, 0);
    const passedCities = stamps[level] ?? 0;
    // Villes rangées par l'étape (comptée dans le niveau) après laquelle elles tombent.
    const citiesAfter = new Map<number, TrackCity[]>();
    for (const c of route.cities.slice(1)) {
      const at = stationStep(c.index, stepsTotal, span);
      citiesAfter.set(at, [...(citiesAfter.get(at) ?? []), c]);
    }
    const nextCity = passedCities < span ? passedCities + 1 : undefined;
    const city = (c: TrackCity): Pending => ({
      kind: "city",
      gap: GAP[c.size],
      r: RADIUS[c.size],
      make: (b) => ({ ...b, kind: "city", city: c, passed: c.index <= passedCities || c.index === 0, next: c.index === nextCity }),
    });

    // La suite des nœuds de la route, puis leur placement.
    const seq: { item: Pending; marker?: TrackMarker; section?: string }[] = [];
    seq.push({ item: city(route.cities[0]) });
    let levelStep = 0;
    for (const l of levelLessons) {
      const done = doneSet(l);
      const globalIdx = lessons.indexOf(l);
      const dim = !l.open && !l.completed;
      let firstOfLesson = true;
      for (const step of l.steps) {
        const isCur = current?.kind === "step" && current.lessonId === l.id && current.step === step;
        if ((current?.kind === "inserted-review" || current?.kind === "targeted-review") && current.lessonId === l.id && current.step === step) {
          const extra = current.kind;
          seq.push({
            item: { kind: "extra", gap: GAP.extra, r: 38, make: (b) => ({ ...b, kind: "extra", extra, lessonId: l.id, state: "cur", dim: false }) },
            ...(firstOfLesson ? { marker: lessonMarker(l, dim), section: l.id } : {}),
          });
          firstOfLesson = false;
        }
        const state: NodeState = isCur ? "cur" : done.has(step) ? "done" : "todo";
        const number = (bases.get(l.id) ?? 0) + l.steps.indexOf(step) + 1;
        seq.push({
          item: {
            kind: "step",
            gap: GAP.step + (isCur ? 16 : 0),
            r: stepRadius(step, isCur),
            make: (b) => ({ ...b, kind: "step", lessonId: l.id, step, number, state, dim }),
          },
          ...(firstOfLesson ? { marker: lessonMarker(l, dim), section: l.id } : {}),
        });
        firstOfLesson = false;
        levelStep++;
        for (const c of citiesAfter.get(levelStep) ?? []) seq.push({ item: city(c) });
      }
      // Station de repos toutes les 5 leçons, entre le contrôle et le cours suivant.
      const hasNext = globalIdx + 1 < lessons.length && lessons[globalIdx + 1].level === level;
      if ((globalIdx + 1) % 5 === 0 && hasNext) {
        const isCur = current?.kind === "rest" && current.lessonId === l.id;
        const state: NodeState = isCur ? "cur" : l.restDone ? "done" : "todo";
        seq.push({
          item: { kind: "extra", gap: GAP.extra, r: isCur ? 38 : 32, make: (b) => ({ ...b, kind: "extra", extra: "rest", lessonId: l.id, state, dim }) },
        });
      }
    }
    // Villes sans étape (niveau plus court que sa route) : à la suite, jusqu'au terminus.
    for (const [at, cs] of citiesAfter) if (at > levelStep) for (const c of cs) seq.push({ item: city(c) });

    // Placement : y cumulé, x en zigzag le long de la route.
    const routeNodes: TrackNode[] = [];
    let prevCur = false;
    seq.forEach(({ item, marker, section }, i) => {
      const prevY = y;
      if (marker && section) {
        const prev = sections[sections.length - 1];
        if (prev) prev.y1 = y;
        sections.push({ lessonId: section, level, y0: y, y1: y });
      }
      // Après l'étape à faire, de la place pour sa bulle ; avant une leçon, son séparateur.
      y += i === 0 ? 0 : item.gap + (marker ? LESSON_MARK : 0) + (prevCur ? AFTER_CUR : 0);
      if (marker) markers.push({ ...marker, y: (prevY + y) / 2 } as TrackMarker);
      const x = cx + amp * ZIGZAG[i % ZIGZAG.length];
      const nextX = cx + amp * ZIGZAG[(i + 1) % ZIGZAG.length];
      const node = item.make({ id: "", level, x, y, r: item.r, dist: 0, side: sideFor(x, cx, nextX) });
      node.id =
        node.kind === "step" ? `${node.lessonId}:${node.step}` : node.kind === "city" ? `city:${level}:${node.city.index}` : `${node.extra}:${node.lessonId ?? level}`;
      if (node.kind === "city" && node.passed && node.city.index > 0) {
        const s = STAMP;
        const sx = node.side === "right" ? node.x - node.r - 16 - s : node.x + node.r + 16;
        node.stamp = { x: Math.max(8, Math.min(width - 8 - s, sx)), y: node.y - s / 2, w: s, h: s };
      }
      routeNodes.push(node);
      prevCur = (node.kind === "step" || node.kind === "extra") && node.state === "cur";
    });

    const points = routeNodes.map((n) => ({ x: n.x, y: n.y }));
    const isLastLevel = li === levels.length - 1;
    const levelReached = levelLessons.every((l) => l.completed);
    // Après le terminus : un bout de voie jusqu'au butoir.
    const tail = { x: points[points.length - 1].x, y: points[points.length - 1].y + 60 };
    points.push(tail);
    const dists = [0];
    for (let i = 1; i < points.length; i++) dists.push(dists[i - 1] + segmentLength(points[i - 1], points[i]));
    routeNodes.forEach((n, i) => (n.dist = dists[i]));
    nodes.push(...routeNodes);
    paths.push({ level, points, dists, length: dists[dists.length - 1], buffer: !isLastLevel || levelReached, painted: 0 });
    y = tail.y;

    if (!isLastLevel) {
      markers.push({ kind: "route-end", level, nextLevel: levels[li + 1], y: y + 24, height: ROUTE_END_H, reached: levelReached });
      y += ROUTE_END_H;
    } else {
      markers.push({ kind: "curriculum-end", level, y: y + 24, height: CURRICULUM_END_H });
      y += CURRICULUM_END_H;
    }
  });
  const lastSection = sections[sections.length - 1];
  if (lastSection) lastSection.y1 = y;

  // Révision libre au bout du curriculum : un nœud à part, dans la zone de fin.
  if (current?.kind === "free-review" && paths.length) {
    const end = markers[markers.length - 1];
    const node: TrackNode = {
      kind: "extra", extra: "free-review", state: "cur", dim: false,
      id: "free-review", level: end.level, x: cx, y: end.y + 120, r: 38, dist: 0, side: "right",
    };
    nodes.push(node);
  }

  // Le nœud à faire, la bulle, le train et les rails peints.
  const cur = nodes.find((n) => (n.kind === "step" || n.kind === "extra") && n.state === "cur");
  let bubble: Box | undefined;
  let train: TrackLayout["train"];
  if (cur) {
    const w = Math.min(BUBBLE_W, width - 32);
    const left = cur.side === "right" ? cur.x + cur.r + 14 : cur.x - cur.r - 14 - w;
    bubble = { x: Math.max(16, Math.min(width - 16 - w, left)), y: cur.y - 56, w, h: BUBBLE_H };
    const path = paths.find((p) => p.level === cur.level);
    if (path && cur.id !== "free-review") {
      const idx = nodes.filter((n) => n.level === cur.level).indexOf(cur);
      const prev = idx > 0 ? nodes.filter((n) => n.level === cur.level)[idx - 1] : undefined;
      const want = cur.dist - cur.r - 4 - TRAIN_LENGTH / 2;
      const floor = prev ? prev.dist + prev.r + TRAIN_LENGTH / 2 : TRAIN_LENGTH / 2;
      train = { level: cur.level, dist: Math.max(Math.min(want, cur.dist), Math.min(floor, cur.dist)) };
    }
  }
  const curLevelIdx = cur ? levels.indexOf(cur.level) : firstOpenIdx < 0 ? levels.length : levels.indexOf(lessons[firstOpenIdx].level);
  for (const p of paths) {
    const li = levels.indexOf(p.level);
    p.painted = li < curLevelIdx ? p.length : li === curLevelIdx && train ? train.dist + TRAIN_LENGTH / 2 : 0;
  }

  // Zones interdites au décor.
  const keepOut: Box[] = [];
  for (const n of nodes) {
    keepOut.push({ x: n.x - n.r - 24, y: n.y - n.r - 24, w: 2 * n.r + 48, h: 2 * n.r + 48 });
    if (n.kind === "city" && n.stamp) keepOut.push(n.stamp);
    const lx = n.side === "right" ? n.x + n.r + 8 : n.x - n.r - 8 - LABEL_W;
    keepOut.push({ x: lx, y: n.y - 30, w: LABEL_W, h: 62 });
  }
  for (const m of markers) keepOut.push({ x: 0, y: m.y - 20, w: width, h: m.kind === "lesson" ? 40 : m.height });
  if (bubble) keepOut.push(bubble);

  return { width, height: y + 80, nodes, markers, paths, current: cur, bubble, train, keepOut, sections };
}

function lessonMarker(l: TrackLesson, dim: boolean): TrackMarker {
  return { kind: "lesson", lessonId: l.id, number: l.number, level: l.level, y: 0, dim };
}
