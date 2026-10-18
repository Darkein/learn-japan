// L'horizon de la voie (SPEC §5c.6b) : calcul PUR de la bande collée sous le bandeau de leçon.
// Le ciel en haut ; dessous, un sol en perspective où la voie qui passe sous la bande est
// projetée sans couture (échelle 1 au raccord, puis les virages se resserrent vers l'horizon) ;
// dans le ciel, les repères des villes qui grandissent quand leur ville approche.

import type { DecorItem, DecorUnique, RouteScenery, SpriteKind, UniqueKind } from "./scenery";
import { WATER_H } from "./scenery";
import { samplePath, type TrackLayout, type TrackNode, type TrackPath } from "./track";

/** Hauteur du ciel : repliée, et grande au départ (le panorama). */
export const SKY_MIN = 84;
export const SKY_MAX = 240;
/** Hauteur du sol qui fuit, sous le ciel. */
export const GROUND = 100;
/** Hauteur de la bande dépliée : place gardée au-dessus de la voie. */
export const BAND_MAX = SKY_MAX + GROUND;
/** Profondeur projetée : au-delà, tout tient dans le dernier pixel (f ≈ 0,07). */
const DEPTH = 14 * GROUND;
/** Ce qui dépasse sous le raccord est dessiné aussi, coupé au raccord (pas de couture). */
const BELOW = 120;
/** Période des traverses le long du tracé (comme ui/track/Rails). */
const SLEEPER_PERIOD = 7.4;

/** Hauteur du ciel quand la bande a défilé de `u` px au-delà de sa place collée. */
export function skyHeight(u: number): number {
  return Math.max(SKY_MIN, Math.min(SKY_MAX, SKY_MAX - Math.max(0, u)));
}

export interface Projected {
  x: number;
  /** Ordonnée dans la bande (0 = haut du ciel). */
  y: number;
  /** Échelle en largeur ; en hauteur, f². */
  f: number;
}

/**
 * Un point de la voie (x, cy) vu dans la bande. `cB` est l'ordonnée de voie du raccord (le bas
 * du sol) : en dessous, rien ne change ; au-dessus, à la distance d, la largeur se resserre
 * d'un facteur f = 1 / (1 + d / 2Z) vers le centre, la hauteur de f².
 */
export function project(x: number, cy: number, cB: number, skyH: number, width: number): Projected {
  const base = skyH + GROUND;
  if (cy >= cB) return { x, y: base + (cy - cB), f: 1 };
  const f = 1 / (1 + (cB - cy) / (2 * GROUND));
  return { x: width / 2 + (x - width / 2) * f, y: skyH + GROUND * f * f, f };
}

/** Opacité d'un élément debout qui s'estompe sous l'échelle `from`. */
export function fade(f: number, from: number, span = 0.2): number {
  return Math.max(0, Math.min(1, (f - from) / span));
}

// ---- La voie échantillonnée -------------------------------------------------------------

export interface TrackSample {
  x: number;
  y: number;
  /** Distance le long du tracé. */
  d: number;
}

export interface SampledPath {
  level: number;
  pts: TrackSample[];
  painted: number;
}

/** Le tracé de chaque route, échantillonné une fois avec la mise en page. */
export function sampleTracks(paths: TrackPath[]): SampledPath[] {
  return paths.map((p) => {
    const raw = samplePath(p, 16);
    let d = 0;
    const pts = raw.map((q, i) => {
      if (i) d += Math.hypot(q.x - raw[i - 1].x, q.y - raw[i - 1].y);
      return { x: q.x, y: q.y, d };
    });
    // Recalé sur la longueur exacte du tracé : le train et les rails peints s'y repèrent.
    const k = d > 0 ? p.length / d : 1;
    for (const q of pts) q.d *= k;
    return { level: p.level, pts, painted: p.painted };
  });
}

/** Premier indice dont l'ordonnée atteint y (le tracé descend). */
function firstAt(pts: TrackSample[], y: number): number {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (pts[m].y < y) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Un ruban de demi-largeur hw × f le long de points projetés. */
function ribbon(pts: Projected[], hw: number): string {
  if (pts.length < 2) return "";
  const left: string[] = [];
  const right: string[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, pts.length - 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * hw * p.f;
    const ny = (dx / len) * hw * p.f;
    left.push(`${r1(p.x + nx)} ${r1(p.y + ny)}`);
    right.push(`${r1(p.x - nx)} ${r1(p.y - ny)}`);
  });
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

// ---- La scène du sol ------------------------------------------------------------------

export interface GroundTrack {
  level: number;
  /** Bord du ballast, ballast, rails, rails peints, creux entre les rails. */
  edge: string;
  ballast: string;
  rail: string;
  painted: string;
  inner: string;
  /** Traverses : sous les rails, et entre eux. */
  sleepers: string;
  sleepersIn: string;
}

export interface GroundNode {
  node: TrackNode;
  /** Disque couché : centre et demi-axes. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  f: number;
  /** Ancre du libellé (debout). */
  label?: { x: number; y: number; f: number; opacity: number };
  /** Opacité du kanji, debout au centre du disque. */
  glyph: number;
}

export interface GroundSprite {
  /** Pied du sprite dans la bande, et échelle à lui appliquer autour de son pied (voie). */
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  f: number;
  opacity: number;
}

export interface GroundScene {
  tracks: GroundTrack[];
  nodes: GroundNode[];
  items: (GroundSprite & { item: DecorItem })[];
  uniques: (GroundSprite & { unique: DecorUnique })[];
  /** L'eau des traversées, aplatie en bande. */
  waters: string[];
  separators: { x1: number; x2: number; y: number; f: number; opacity: number; label: string; dim: boolean }[];
  train?: { level: number; x: number; y: number; angle: number; f: number };
}

/** La voie qui passe sous la bande, projetée sur le sol qui fuit. */
export function groundScene(
  layout: TrackLayout,
  tracks: SampledPath[],
  decor: { items: DecorItem[]; uniques: DecorUnique[]; crossings: { y: number }[] } | undefined,
  cB: number,
  skyH: number,
): GroundScene {
  const W = layout.width;
  const far = cB - DEPTH;
  const near = cB + BELOW;
  const P = (x: number, y: number) => project(x, y, cB, skyH, W);

  const out: GroundScene = { tracks: [], nodes: [], items: [], uniques: [], waters: [], separators: [] };

  for (const t of tracks) {
    const pts = t.pts;
    if (!pts.length || pts[0].y > near || pts[pts.length - 1].y < far) continue;
    const a = Math.max(0, firstAt(pts, far) - 1);
    const b = Math.min(pts.length - 1, firstAt(pts, near));
    if (b <= a) continue;
    const seg = pts.slice(a, b + 1);
    const proj = seg.map((q) => P(q.x, q.y));
    const paintedTo = seg.findIndex((q) => q.d > t.painted);
    const paintedPts = paintedTo < 0 ? proj : proj.slice(0, Math.max(0, paintedTo));

    // Les traverses : posées tous les 7,4 px le long du tracé, elles se resserrent d'elles-mêmes.
    let sleepers = "";
    let sleepersIn = "";
    for (let i = 1; i < seg.length; i++) {
      const q0 = seg[i - 1];
      const q1 = seg[i];
      const len = q1.d - q0.d;
      if (len <= 0) continue;
      for (let m = Math.ceil(q0.d / SLEEPER_PERIOD) * SLEEPER_PERIOD; m < q1.d; m += SLEEPER_PERIOD) {
        const k = (m - q0.d) / len;
        const p = P(q0.x + (q1.x - q0.x) * k, q0.y + (q1.y - q0.y) * k);
        if (p.f < 0.45) continue;
        // Le pas d'un px de tracé, à l'écran : il donne l'épaisseur et le sens de la traverse.
        const sx = (proj[i].x - proj[i - 1].x) / len;
        const sy = (proj[i].y - proj[i - 1].y) / len;
        const sl = Math.hypot(sx, sy) || 1;
        const quad = (hw: number) => {
          const nx = (-sy / sl) * hw * p.f;
          const ny = (sx / sl) * hw * p.f;
          const ax = sx * 1.2;
          const ay = sy * 1.2;
          return `M${r1(p.x - nx - ax)} ${r1(p.y - ny - ay)}L${r1(p.x + nx - ax)} ${r1(p.y + ny - ay)}L${r1(p.x + nx + ax)} ${r1(p.y + ny + ay)}L${r1(p.x - nx + ax)} ${r1(p.y - ny + ay)}Z`;
        };
        sleepers += quad(6);
        sleepersIn += quad(2.6);
      }
    }

    out.tracks.push({
      level: t.level,
      edge: ribbon(proj, 9),
      ballast: ribbon(proj, 8.2),
      rail: ribbon(proj, 3.5),
      painted: ribbon(paintedPts, 3.5),
      inner: ribbon(proj, 2.6),
      sleepers,
      sleepersIn,
    });

    // Le train, s'il est passé sous la bande : debout, orienté selon la voie projetée.
    const tr = layout.train;
    if (tr && tr.level === t.level) {
      const i = seg.findIndex((q) => q.d >= tr.dist);
      if (i > 0) {
        const q0 = seg[i - 1];
        const q1 = seg[i];
        const k = (tr.dist - q0.d) / (q1.d - q0.d || 1);
        const y = q0.y + (q1.y - q0.y) * k;
        if (y < cB + 20) {
          const p = P(q0.x + (q1.x - q0.x) * k, y);
          const angle = (Math.atan2(proj[i].y - proj[i - 1].y, proj[i].x - proj[i - 1].x) * 180) / Math.PI;
          if (p.f >= 0.3) out.train = { level: t.level, x: p.x, y: p.y, angle, f: p.f };
        }
      }
    }
  }

  // Les arrêts : disques couchés ; kanji et libellés restent debout.
  for (const n of layout.nodes) {
    if (n.y < far || n.y - n.r > near) continue;
    const p = P(n.x, n.y);
    if (p.f < 0.12) continue;
    const showLabel = !(n.kind !== "city" && n.state === "cur");
    let label: GroundNode["label"];
    if (showLabel) {
      const lx = n.side === "right" ? n.x + n.r + 10 : n.x - n.r - 10;
      const a = P(lx, n.y - 26);
      const opacity = fade(a.f, 0.8, 0.15);
      if (opacity > 0) label = { x: a.x, y: a.y, f: a.f, opacity };
    }
    out.nodes.push({ node: n, x: p.x, y: p.y, rx: n.r * p.f, ry: n.r * p.f * p.f, f: p.f, label, glyph: fade(p.f, 0.6) });
  }

  // Le décor : debout, il rapetisse autour de son pied.
  if (decor) {
    for (const it of decor.items) {
      const baseX = it.x + 60 * it.scale;
      const baseY = it.y + 76 * it.scale;
      if (baseY < far || it.y > near) continue;
      const p = P(baseX, baseY);
      const opacity = fade(p.f, 0.3, 0.3);
      if (opacity > 0) out.items.push({ item: it, x: p.x, y: p.y, baseX, baseY, f: p.f, opacity });
    }
    for (const u of decor.uniques) {
      const baseX = u.box.x + u.box.w / 2;
      const baseY = u.box.y + u.box.h;
      if (baseY < far || u.box.y > near) continue;
      const p = P(baseX, baseY);
      const opacity = fade(p.f, 0.25, 0.3);
      if (opacity > 0) out.uniques.push({ unique: u, x: p.x, y: p.y, baseX, baseY, f: p.f, opacity });
    }
    for (const c of decor.crossings) {
      const top = c.y - WATER_H / 2;
      if (c.y + WATER_H / 2 < far || top > cB) continue;
      const a = P(0, top);
      const b = P(W, top);
      const cc = P(W, top + WATER_H);
      const d = P(0, top + WATER_H);
      out.waters.push(`M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}L${r1(cc.x)} ${r1(cc.y)}L${r1(d.x)} ${r1(d.y)}Z`);
    }
  }

  // Les séparateurs de leçon : un filet posé au sol, son nom debout.
  for (const m of layout.markers) {
    if (m.kind !== "lesson" || m.y < far || m.y > near) continue;
    const a = P(16, m.y);
    const b = P(W - 16, m.y);
    const opacity = fade(a.f, 0.35, 0.3);
    if (opacity > 0) out.separators.push({ x1: a.x, x2: b.x, y: a.y, f: a.f, opacity, label: `Leçon ${m.number}`, dim: m.dim });
  }

  return out;
}

// ---- Les repères du ciel --------------------------------------------------------------

/** Le sprite du catalogue qui dessine le repère d'une illustration unique. */
const UNIQUE_SPRITE: Record<UniqueKind, SpriteKind> = {
  edo: "bridge", "fuji-hara": "fuji", "fuji-satta": "fuji", hakone: "lake-torii", "oi-ford": "ford",
  hamana: "lake", "miya-ferry": "ferry", kyoto: "pagoda", saruhashi: "bridge", kai: "fuji", suwa: "lake",
  "usui-asama": "volcano", kiso: "town", biwa: "lake", fukagawa: "boats", nikko: "shrine",
  matsushima: "pines", hiraizumi: "temple", yamadera: "temple", kisakata: "lake", ogaki: "castle",
  naruto: "sea", muroto: "sea", iya: "bridge", zentsuji: "pagoda", okuboji: "temple",
};

/** Le sprite du motif d'une ville (son repère principal). */
const MOTIF_SPRITE: Partial<Record<string, SpriteKind>> = {
  castle: "castle", bridge: "bridge", mountain: "ridge", fuji: "fuji", wave: "sea", temple: "temple",
  shrine: "torii", lake: "lake", pine: "pines", town: "roofs", boat: "boats", gate: "gate",
  tea: "tea", pagoda: "pagoda",
};

export interface SkyMark {
  id: string;
  /** Ordonnée de la ville sur la voie. */
  y: number;
  kind: SpriteKind;
  name: string;
  /** Côté du ciel où il se lève (alterné d'une ville à l'autre). */
  side: -1 | 1;
}

/** Les villes de la voie qui ont un repère dans le ciel. */
export function skyMarks(layout: TrackLayout, sceneries: RouteScenery[]): SkyMark[] {
  const out: SkyMark[] = [];
  for (const n of layout.nodes) {
    if (n.kind !== "city") continue;
    const sc = sceneries.find((s) => s.level === n.level)?.cities[n.city.index];
    let kind: SpriteKind | undefined;
    if (sc?.unique) kind = UNIQUE_SPRITE[sc.unique];
    else if (n.city.size !== "village") kind = MOTIF_SPRITE[n.city.motif ?? sc?.motif ?? ""];
    if (!kind) continue;
    out.push({ id: n.id, y: n.y, kind, name: `${n.city.kanji} · ${n.city.romaji}`, side: n.city.index % 2 ? 1 : -1 });
  }
  return out;
}

export interface SkyMarkPose {
  mark: SkyMark;
  /** Centre et largeur du sprite (boîte 120 × 80), dans le ciel. */
  x: number;
  w: number;
  opacity: number;
  label: number;
}

/**
 * Où en est chaque repère : il naît à l'horizon quand sa ville entre à l'écran par le bas
 * (`visible` px de voie sous le raccord), grandit jusqu'au tiers haut de la voie visible, puis
 * rapetisse quand la ville file vers l'horizon.
 */
export function skyMarkPoses(marks: SkyMark[], cB: number, visible: number, skyH: number, width: number): SkyMarkPose[] {
  const ref = cB + visible / 3;
  const up = Math.max(1, (visible * 2) / 3);
  const down = visible / 3 + 160;
  const wMax = Math.min(150, skyH * 1.1);
  const out: SkyMarkPose[] = [];
  for (const m of marks) {
    const dist = m.y - ref;
    let s = dist >= 0 ? 1 - dist / up : 1 + dist / down;
    if (s <= 0) continue;
    s = Math.min(1, s);
    s = s * s * (3 - 2 * s);
    const w = wMax * (0.25 + 0.75 * s);
    let x = width / 2 + m.side * (30 + width * 0.22 * s);
    x = Math.min(width - w / 2 - 8, Math.max(w / 2 + 8, x));
    out.push({ mark: m, x, w, opacity: Math.min(1, s * 2.5), label: fade(s, 0.55, 0.3) });
  }
  return out;
}

