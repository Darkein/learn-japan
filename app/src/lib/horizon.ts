// La bande de ciel de la voie (SPEC §5c.6b) : calcul PUR. Le panorama du départ qui se replie,
// le décor qui défile en deux plans, tiré du paysage du tronçon, et entre les deux les repères
// des villes, qui passent au milieu de l'horizon quand leur ville est au tiers haut de l'écran.

import type { Biome, RouteScenery, SpriteKind, UniqueKind } from "./scenery";
import type { TrackLayout } from "./track";

/** Hauteur du ciel : repliée, et grande au départ (le panorama). */
export const SKY_MIN = 120;
export const SKY_MAX = 280;

/** Hauteur du ciel quand la bande a défilé de `u` px au-delà de sa place collée. */
export function skyHeight(u: number): number {
  return Math.max(SKY_MIN, Math.min(SKY_MAX, SKY_MAX - Math.max(0, u)));
}

// ---- Les repères ---------------------------------------------------------------------

/** Le sprite du catalogue qui dessine le repère d'une illustration unique. */
const UNIQUE_SPRITE: Record<UniqueKind, SpriteKind> = {
  edo: "bridge", "fuji-hara": "fuji", "fuji-satta": "fuji", hakone: "lake-torii", "oi-ford": "ford",
  hamana: "lake", "miya-ferry": "ferry", kyoto: "pagoda", saruhashi: "bridge", kai: "fuji", suwa: "lake",
  "usui-asama": "volcano", kiso: "town", biwa: "lake", fukagawa: "boats", nikko: "shrine",
  matsushima: "pines", hiraizumi: "temple", yamadera: "temple", kisakata: "lake", ogaki: "castle",
  naruto: "sea", muroto: "sea", iya: "bridge", zentsuji: "pagoda", okuboji: "temple",
};

/** Le sprite du motif d'une ville (son repère principal). Les monts et les vagues n'en ont pas :
    le ciel a déjà ses crêtes, et la mer ne se dresse pas sur l'horizon. */
const MOTIF_SPRITE: Partial<Record<string, SpriteKind>> = {
  castle: "castle", bridge: "bridge", fuji: "fuji", temple: "temple",
  shrine: "torii", lake: "lake", pine: "pines", town: "roofs", boat: "boats", gate: "gate",
  tea: "tea", pagoda: "pagoda",
};

export interface SkyMark {
  id: string;
  /** Ordonnée de la ville sur la voie. */
  y: number;
  kind: SpriteKind;
  name: string;
  /** Sa place sur l'horizon, en part de la largeur, quand sa ville passe au tiers haut de la voie
      visible ; il glisse autour au fil du défilement (`markX`). */
  x: number;
}

/**
 * Les villes de la voie qui ont un repère dans le ciel : celles qui ont une illustration unique,
 * et les villes, grandes villes et terminus. Deux villes qui se suivent prennent des côtés
 * opposés, pour que deux repères visibles ensemble ne se couvrent pas.
 */
export function skyMarks(layout: TrackLayout, sceneries: RouteScenery[]): SkyMark[] {
  const out: SkyMark[] = [];
  for (const n of layout.nodes) {
    if (n.kind !== "city") continue;
    const sc = sceneries.find((s) => s.level === n.level)?.cities[n.city.index];
    let kind: SpriteKind | undefined;
    if (sc?.unique) kind = UNIQUE_SPRITE[sc.unique];
    else if (n.city.size !== "village") kind = MOTIF_SPRITE[n.city.motif ?? sc?.motif ?? ""];
    if (!kind) continue;
    // Décalage alterné d'un repère au suivant, et léger écart stable par ville.
    const i = n.city.index;
    const x = (out.length % 2 ? 0.6 : 0.44) + ((i * 7) % 8) / 100;
    out.push({ id: n.id, y: n.y, kind, name: `${n.city.kanji} · ${n.city.romaji}`, x });
  }
  return out;
}

/** La crête lointaine : un motif de `RIDGE_PERIOD` px répété, qui glisse le plus lentement. */
export const RIDGE_PERIOD = 300;
export const RIDGE_SPEED = 0.08;
const RIDGE = "L36 10 L72 20 L114 4 L156 18 L201 8 L246 20 L300 22";

/** Le tracé de la crête lointaine (40 px de haut) sur `width` px, quand la voie est à `pos`. */
export function ridgePath(pos: number, width: number): string {
  const shift = (((pos * RIDGE_SPEED) % RIDGE_PERIOD) + RIDGE_PERIOD) % RIDGE_PERIOD;
  let d = `M${shift - RIDGE_PERIOD} 40 L${shift - RIDGE_PERIOD} 22`;
  for (let x0 = shift - RIDGE_PERIOD; x0 < width; x0 += RIDGE_PERIOD) {
    d += " " + RIDGE.replace(/L(-?[\d.]+) /g, (_, x) => `L${Math.round((x0 + Number(x)) * 10) / 10} `);
  }
  return `${d} L${width + RIDGE_PERIOD} 22 L${width + RIDGE_PERIOD} 40 Z`;
}

/** Vitesse des repères : entre le plan moyen et le plan proche du décor qui défile. */
export const MARK_SPEED = 0.35;

/**
 * Où est un repère quand la voie est à `pos` (ordonnée de voie du bas du ciel) : à sa place quand
 * sa ville passe au tiers haut de la voie visible, et il glisse dans le même sens que le décor.
 */
export function markX(mark: SkyMark, pos: number, visible: number, width: number): number {
  return mark.x * width + (pos - (mark.y - visible / 3)) * MARK_SPEED;
}

/** Le nom d'un repère paraît tant que sa ville est sur la voie visible, entre `top` et `bottom`. */
export function markRaised(mark: SkyMark, top: number, bottom: number): boolean {
  return mark.y >= top - 20 && mark.y <= bottom;
}

// ---- Le décor qui défile ---------------------------------------------------------------

/** Les silhouettes du décor qui défile (boîte 40 × 30, pied en bas). */
export type DriftKind = "pine" | "cedars" | "hill" | "field" | "temple" | "house" | "bamboo" | "boat" | "tree";

export const DRIFT_PATHS: Record<DriftKind, string> = {
  pine: "M18 30 h4 v-6 h10 L20 2 L8 24 h10 Z",
  cedars: "M2 30 L10 6 L18 30 Z M12 30 L20 0 L28 30 Z M22 30 L30 8 L38 30 Z",
  hill: "M-6 30 Q20 2 46 30 Z",
  field: "M0 30 L5 26 L40 26 L35 30 Z M7 24 L11 21 L40 21 L36 24 Z",
  temple: "M2 15 Q20 4 38 15 L33 15 L33 30 L7 30 L7 15 Z M14 11 Q20 2 26 11 Z",
  house: "M5 17 L20 8 L35 17 L31 17 L31 30 L9 30 L9 17 Z",
  bamboo: "M10 30 L11 4 L13 4 L12 30 Z M20 30 L21 1 L23 1 L22 30 Z M30 30 L31 6 L33 6 L32 30 Z",
  boat: "M6 26 L34 26 L29 30 L11 30 Z M19 26 L20 8 L21 26 Z",
  tree: "M18 30 L18 20 L22 20 L22 30 Z M9 18 a11 10 0 1 0 22 0 a11 10 0 1 0 -22 0 Z",
};

type Layer = "mid" | "near";

/** Ce que chaque paysage fait défiler : au plan moyen (monts, forêts, temples), au plan proche. */
const DRIFT: Record<Layer, Record<Biome, DriftKind[]>> = {
  mid: {
    coast: ["hill"], plain: ["hill", "cedars"], rice: ["hill", "cedars"], mountain: ["hill", "hill", "cedars"],
    forest: ["cedars", "hill"], lake: ["hill"], river: ["hill", "temple"], town: ["temple", "hill"],
    tea: ["hill"], orchard: ["hill", "cedars"], vineyard: ["hill"],
  },
  near: {
    coast: ["boat", "pine"], plain: ["field", "house", "pine"], rice: ["field", "field", "house", "pine"],
    mountain: ["cedars", "pine"], forest: ["pine", "cedars", "bamboo"], lake: ["boat", "pine"],
    river: ["field", "boat", "pine"], town: ["house", "house", "temple"], tea: ["field", "field", "house"],
    orchard: ["tree", "tree", "house"], vineyard: ["field", "tree"],
  },
};

/** Vitesse (part du défilement), espacement et échelle de chaque plan. */
const LAYERS: Record<Layer, { speed: number; spacing: number; scale: number }> = {
  mid: { speed: 0.22, spacing: 44, scale: 1.15 },
  near: { speed: 0.55, spacing: 40, scale: 1 },
};

/** Le paysage de la voie, tronçon par tronçon : la ville où il mène, et son paysage. */
export function biomeTrack(layout: TrackLayout, sceneries: RouteScenery[]): { y: number; biome: Biome }[] {
  const out: { y: number; biome: Biome }[] = [];
  for (const n of layout.nodes) {
    if (n.kind !== "city") continue;
    const biome = sceneries.find((s) => s.level === n.level)?.cities[n.city.index]?.biome;
    out.push({ y: n.y, biome: biome ?? "plain" });
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Le paysage à l'ordonnée y de la voie : celui du tronçon qui mène à la ville suivante. */
export function biomeAt(track: { y: number; biome: Biome }[], y: number): Biome {
  for (const t of track) if (t.y >= y) return t.biome;
  return track.at(-1)?.biome ?? "plain";
}

function hash(i: number, k: number): number {
  let h = (i * 374761393 + k * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface DriftItem {
  key: string;
  kind: DriftKind;
  /** Centre du pied, en px depuis la gauche ; échelle (boîte 40 × 30). */
  x: number;
  scale: number;
}

/**
 * Le décor d'un plan quand la voie est à `pos` (ordonnée de voie du bas du ciel) : chaque
 * élément a son rang sur une bande sans fin, glisse de `speed` px par px défilé, et prend le
 * paysage du tronçon où l'on est quand il passe au milieu (`ahead` px plus bas). Stable d'une
 * visite à l'autre : tout se tire du rang.
 */
export function driftItems(
  layer: Layer,
  pos: number,
  width: number,
  ahead: number,
  biome: (y: number) => Biome,
): DriftItem[] {
  const { speed, spacing, scale } = LAYERS[layer];
  const salt = layer === "mid" ? 1 : 2;
  const off = pos * speed;
  const out: DriftItem[] = [];
  for (let i = Math.floor((off - 80) / spacing); i <= Math.ceil((off + width + 80) / spacing); i++) {
    if (hash(i, salt) < 0.3) continue;
    const kinds = DRIFT[layer][biome((i * spacing - width / 2) / speed + ahead)];
    const kind = kinds[Math.floor(hash(i, 7 + salt) * kinds.length)];
    const x = width - (i * spacing - off) + hash(i, 5 + salt) * spacing * 0.4;
    if (x < -60 || x > width + 60) continue;
    out.push({ key: `${layer}${i}`, kind, x, scale: scale * (0.8 + hash(i, 9 + salt) * 0.45) });
  }
  return out;
}
