// Le décor de la voie (SPEC §5c.6) : placement PUR des éléments le long des routes. Les données
// de chaque route (data/scenery/*) disent quoi mettre et où (repères réels des villes,
// paysage et traversées des tronçons) ; ce module décide où le dessiner sans jamais couvrir
// un arrêt, un libellé, la bulle ni les rails, de façon stable d'une visite à l'autre.

import type { Box, TrackLayout, TrackNode, TrackPoint } from "./track";
import { samplePath } from "./track";

export type SpriteKind =
  | "fuji" | "ridge" | "ford" | "bridge" | "lake" | "lake-torii" | "sea" | "rice" | "tea"
  | "pines" | "pine" | "cedars" | "bamboo" | "sakura" | "maple" | "hydrangea" | "rain"
  | "ichirizuka" | "signpost" | "jizo" | "lantern" | "teahouse" | "town" | "gate" | "ferry"
  | "torii" | "shrine" | "temple" | "pagoda" | "castle" | "boats" | "kura" | "watermill"
  | "vines" | "orchard" | "waterfall";

export type Biome =
  | "coast" | "plain" | "rice" | "mountain" | "forest" | "lake" | "river" | "town" | "tea"
  | "orchard" | "vineyard";

export type Season = "spring" | "rainy" | "summer" | "autumn" | "winter" | "none";

/** Un repère réel d'une ville (données de route). */
export interface Landmark {
  kind: SpriteKind;
  /** Côté imposé (sinon : le côté libre, opposé au libellé de la ville). */
  side?: "left" | "right";
  /** Grand repère, au loin (le Fuji, une chaîne) : plus grand et pâle, derrière tout. */
  far?: boolean;
}

/** Le décor d'une route : repères par ville, paysage et traversée par tronçon. */
export interface RouteScenery {
  level: number;
  /** Repères de la ville d'index donné, dessinés autour d'elle. */
  landmarks?: Record<number, Landmark[]>;
  /** Paysage du tronçon qui MÈNE à la ville d'index donné (de la ville précédente à elle). */
  biomes?: Record<number, Biome>;
  /** Traversée sur ce même tronçon : l'eau croise la voie. */
  crossings?: Record<number, "bridge" | "ford" | "ferry">;
  /** Saison imposée autour d'une ville (Kanbara sous la neige, Shōno sous l'averse). */
  forced?: Record<number, "snow" | "rain">;
}

/** La boîte qu'occupe vraiment le dessin d'un élément (pour les collisions). */
export function inkBox(it: Pick<DecorItem, "x" | "y" | "scale">): Box {
  const w = 120 * it.scale;
  const h = 80 * it.scale;
  return { x: it.x + INK.x * w, y: it.y + INK.y * h, w: INK.w * w, h: INK.h * h };
}

export interface DecorItem {
  kind: SpriteKind;
  /** Coin haut-gauche de la boîte (120 × 80 à l'échelle 1). */
  x: number;
  y: number;
  scale: number;
  flip: boolean;
  /** Au loin : dessiné en premier, pâle, sans contrainte de place. */
  far: boolean;
  snowy: boolean;
}

/** Une traversée : la bande d'eau sur toute la largeur, et le tablier sous les rails. */
export interface DecorCrossing {
  type: "bridge" | "ford" | "ferry";
  y: number;
  /** Abscisse des rails à cette hauteur. */
  x: number;
}

export interface Decor {
  items: DecorItem[];
  crossings: DecorCrossing[];
}

/** Hauteur réservée sur la voie pour une traversée (la bande d'eau et ses rives). */
export const CROSSING_H = 96;
/** Hauteur de la bande d'eau d'une traversée. */
export const WATER_H = 40;

/** Les places que le décor d'une route réserve sur la voie, par ville où mène le tronçon. */
export function reserveOf(scenery: RouteScenery | undefined): Record<number, number> {
  const out: Record<number, number> = {};
  for (const k of Object.keys(scenery?.crossings ?? {})) out[Number(k)] = CROSSING_H;
  return out;
}

/** Saison du calendrier réel (SPEC §5c.6), date locale. */
export function seasonOf(d: Date): Season {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 20) || m === 4) return "spring";
  if (m === 6) return "rainy";
  if (m === 7 || m === 8) return "summer";
  if (m === 10 || m === 11) return "autumn";
  if (m === 12 || m <= 2) return "winter";
  return "none";
}

/** Ce que chaque paysage pose entre les repères. */
const FILLERS: Record<Biome, SpriteKind[]> = {
  coast: ["boats", "pines", "pine", "sea", "pines"],
  plain: ["pine", "rice", "pines", "signpost", "jizo", "pine"],
  rice: ["rice", "rice", "pine", "watermill"],
  mountain: ["cedars", "jizo", "cedars", "teahouse", "pine"],
  forest: ["cedars", "bamboo", "pine", "jizo"],
  lake: ["lake", "pines", "boats"],
  river: ["watermill", "pines", "rice"],
  town: ["town", "kura", "lantern", "shrine", "temple"],
  tea: ["tea", "tea", "pine"],
  orchard: ["orchard", "orchard", "pine"],
  vineyard: ["vines", "vines", "pine"],
};
const TREES: ReadonlySet<SpriteKind> = new Set(["pine", "pines", "cedars"]);
/** Échelle « près de la voie » de chaque élément (les grands à moitié, les petits plus). */
const NEAR_SCALE: Partial<Record<SpriteKind, number>> = {
  jizo: 0.5, lantern: 0.5, signpost: 0.5, ichirizuka: 0.46, torii: 0.62, pine: 0.7,
};
const DEFAULT_SCALE = 0.76;
/** Boîte occupée par le dessin dans sa boîte de 120 × 80 (le reste est du vide). */
const INK = { x: 0.08, y: 0.18, w: 0.84, h: 0.8 };
/** Distance minimale entre un élément et les rails. */
const RAIL_CLEAR = 16;
/** Densité du remplissage : éléments par tranche de cette hauteur, des deux côtés. */
const FILL_PER = 200;

/** Décalages essayés, dans l'ordre, quand la place voulue est prise. */
const NUDGES: [number, number][] = [
  [0, 0], [-14, 0], [14, 0], [0, -24], [0, 24], [-28, -12], [28, 12], [-40, 30], [40, -30], [0, -48], [0, 48],
];

/** PRNG déterministe (mulberry32) : même tronçon, même décor. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Index des boîtes interdites par bande verticale, pour des tests rapides. */
class BoxIndex {
  private bands = new Map<number, Box[]>();
  constructor(private band = 200) {}
  add(b: Box): void {
    for (let k = Math.floor(b.y / this.band); k <= Math.floor((b.y + b.h) / this.band); k++) {
      const list = this.bands.get(k) ?? [];
      list.push(b);
      this.bands.set(k, list);
    }
  }
  hits(b: Box): boolean {
    for (let k = Math.floor(b.y / this.band); k <= Math.floor((b.y + b.h) / this.band); k++) {
      for (const o of this.bands.get(k) ?? []) if (overlaps(b, o)) return true;
    }
    return false;
  }
}

/** Les rails passent-ils dans la boîte (marge comprise) ? */
function onRails(b: Box, samples: TrackPoint[]): boolean {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].y < b.y - RAIL_CLEAR) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < samples.length && samples[i].y <= b.y + b.h + RAIL_CLEAR; i++) {
    const p = samples[i];
    if (p.x > b.x - RAIL_CLEAR && p.x < b.x + b.w + RAIL_CLEAR) return true;
  }
  return false;
}

/** Abscisse des rails à la hauteur y (échantillons triés par y). */
function railX(samples: TrackPoint[], y: number): number {
  let best = samples[0];
  for (const p of samples) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
  return best?.x ?? 0;
}

/** Remplacement saisonnier d'un arbre (cerisiers au printemps, érables à l'automne). */
function seasonal(kind: SpriteKind, season: Season, r: () => number): SpriteKind {
  if (!TREES.has(kind)) return kind;
  if (season === "spring" && r() < 0.4) return "sakura";
  if (season === "autumn" && r() < 0.45) return "maple";
  if (season === "rainy" && r() < 0.25) return "hydrangea";
  return kind;
}

export function placeDecor(layout: TrackLayout, sceneries: RouteScenery[], season: Season): Decor {
  const { width } = layout;
  const taken = new BoxIndex();
  for (const b of layout.keepOut) taken.add(b);
  const items: DecorItem[] = [];
  const crossings: DecorCrossing[] = [];

  for (const path of layout.paths) {
    const level = path.level;
    const scenery = sceneries.find((s) => s.level === level);
    const samples = samplePath(path);
    const cities = layout.nodes.filter((n): n is Extract<TrackNode, { kind: "city" }> => n.kind === "city" && n.level === level);
    const steps = layout.nodes.filter((n) => n.kind === "step" && n.level === level);

    /**
     * Pose un élément près de (x, y) : la place voulue, puis de petits décalages, puis (si
     * `scan`) la première place libre sur toute la largeur à cette hauteur, du bord le plus
     * proche vers l'intérieur.
     */
    const tryPlace = (kind: SpriteKind, x: number, y: number, scale: number, snowy: boolean, r: () => number, scan = true): boolean => {
      const w = 120 * scale;
      const h = 80 * scale;
      const lo = -w * 0.15;
      const hi = width - w * 0.85;
      const fits = (bx: number, by: number): boolean => {
        const box = { x: bx + INK.x * w, y: by + INK.y * h, w: INK.w * w, h: INK.h * h };
        if (taken.hits(box) || onRails(box, samples)) return false;
        taken.add(box);
        items.push({ kind, x: bx, y: by, scale, flip: r() < 0.5, far: false, snowy });
        return true;
      };
      for (const [dx, dy] of NUDGES) if (fits(Math.max(lo, Math.min(hi, x + dx)), y + dy)) return true;
      if (!scan) return false;
      const fromLeft = x + w / 2 < width / 2;
      for (const dy of [0, -30, 30]) {
        for (let k = 0; lo + k * 16 <= hi; k++) {
          const bx = fromLeft ? lo + k * 16 : hi - k * 16;
          if (fits(bx, y + dy)) return true;
        }
      }
      return false;
    };

    // Une borne-lieue toutes les 4 étapes, au bord de la voie, du côté libre (posées d'abord :
    // c'est la mesure du chemin, le remplissage vient autour).
    for (const s of steps) {
      if (s.kind !== "step" || s.number % 4 !== 0) continue;
      const r = rng(level * 31 + s.number);
      const scale = NEAR_SCALE.ichirizuka!;
      const x = s.side === "right" ? s.x - s.r - 36 - 120 * scale : s.x + s.r + 36;
      tryPlace("ichirizuka", x, s.y - 20, scale, season === "winter", r, false);
    }

    // D'abord ce qui existe vraiment : traversées, versants, repères des villes.
    cities.forEach((city, k) => {
      const r = rng(level * 1009 + city.city.index * 7919);
      const prev = cities[k - 1];
      const forced = scenery?.forced?.[city.city.index];
      const snowy = season === "winter" || forced === "snow";
      const freeSide = city.side === "right" ? "left" : "right";
      if (prev) {
        const y0 = prev.y + 70;
        const y1 = city.y - 70;
        const crossing = scenery?.crossings?.[city.city.index];
        const band = crossing && layout.reserved.find((b) => b.level === level && b.city === city.city.index);
        if (crossing && band) {
          const y = band.y + band.h / 2;
          crossings.push({ type: crossing, y, x: railX(samples, y) });
          taken.add({ x: -width, y: y - WATER_H / 2 - 6, w: 3 * width, h: WATER_H + 12 });
        }
        if (scenery?.biomes?.[city.city.index] === "mountain" && y1 > y0) {
          // Les versants : deux grandes crêtes pâles, une de chaque côté.
          for (const side of ["left", "right"] as const) {
            const scale = 1.5 + r() * 0.6;
            const x = side === "left" ? -60 * scale : width - 60 * scale;
            items.push({ kind: "ridge", x, y: y0 + r() * Math.max(0, y1 - y0 - 80 * scale), scale, flip: side === "right", far: true, snowy });
          }
        }
      }

      // Les repères de la ville, du côté libre, autour d'elle.
      const marks = scenery?.landmarks?.[city.city.index] ?? [];
      marks.forEach((m, i) => {
        const side = m.side ?? (i % 2 ? (freeSide === "left" ? "right" : "left") : freeSide);
        if (m.far) {
          const scale = 1.7 + r() * 0.4;
          const x = side === "left" ? -30 * scale : width - 90 * scale;
          items.push({ kind: m.kind, x, y: city.y - 80 * scale - 40, scale, flip: false, far: true, snowy });
          return;
        }
        const scale = (NEAR_SCALE[m.kind] ?? 0.78) * 1.1;
        const w = 120 * scale;
        const x = side === "left" ? Math.max(4, city.x - city.r - 30 - w) : Math.min(width - w - 4, city.x + city.r + 30);
        const y = city.y - 80 * scale - 30 - i * 30;
        if (!tryPlace(m.kind, x, y, scale, snowy, r, false)) tryPlace(m.kind, x, city.y + 40 + i * 30, scale, snowy, r);
      });
      if (forced === "rain") items.push({ kind: "rain", x: 0, y: city.y - 120, scale: width / 120, flip: false, far: true, snowy });
    });

    // Puis le remplissage : le paysage de chaque tronçon, avec une graine stable par tronçon.
    cities.forEach((city, k) => {
      const prev = cities[k - 1];
      if (!prev) return;
      const r = rng(level * 7907 + city.city.index * 104729);
      const snowy = season === "winter" || scenery?.forced?.[city.city.index] === "snow";
      const y0 = prev.y + 70;
      const y1 = city.y - 70;
      if (y1 <= y0) return;
      const biome = scenery?.biomes?.[city.city.index] ?? "plain";
      const pool = FILLERS[biome];
      const n = Math.max(1, Math.round(((y1 - y0) / FILL_PER) * (biome === "town" ? 1.4 : 1)));
      for (let i = 0; i < n; i++) {
        const kind = seasonal(pool[Math.floor(r() * pool.length)], season, r);
        const scale = (NEAR_SCALE[kind] ?? DEFAULT_SCALE) * (0.85 + r() * 0.3);
        // Un côté puis l'autre, pour que chaque côté ait son élément.
        const left = (i + city.city.index) % 2 === 0;
        const x = left ? 4 + r() * (width * 0.22) : width - 120 * scale - 4 - r() * (width * 0.22);
        const y = y0 + ((i + r()) / n) * (y1 - y0) - 40 * scale;
        tryPlace(kind, x, y, scale, snowy, r);
      }
    });
  }

  // Le lointain d'abord, puis du haut vers le bas : l'ordre de dessin.
  items.sort((a, b) => (a.far === b.far ? a.y - b.y : a.far ? -1 : 1));
  return { items, crossings };
}
