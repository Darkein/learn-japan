// Le ciel de la voie (SPEC §5c.6, « Le ciel ») : ce qu'il montre à une heure donnée, en module
// pur. L'astre suit l'heure locale, la lune a sa phase réelle, la brume vient au matin, et les
// oiseaux suivent la saison.

import type { Season } from "./scenery";

export type SkyTime = "dawn" | "day" | "dusk" | "night";

export interface SkyBody {
  /** Abscisse en fraction de la largeur (0 à 1). */
  x: number;
  /** Hauteur au-dessus de l'horizon, en fraction (0 = sur l'horizon, 1 = au zénith). */
  alt: number;
}

export interface SkyState {
  time: SkyTime;
  sun?: SkyBody;
  moon?: SkyBody & { phase: number };
  stars: boolean;
  mist: boolean;
  birds?: "swallows" | "geese" | "crane";
  petals: boolean;
  fireflies: boolean;
}

/** Mois synodique moyen, en jours. */
const SYNODIC = 29.530588853;
/** Une nouvelle lune connue (6 janvier 2000, 18 h 14 UTC). */
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Phase de la lune : 0 = nouvelle, 0,5 = pleine, croissante avant, décroissante après. */
export function moonPhase(d: Date): number {
  const days = (d.getTime() - NEW_MOON) / 86400000;
  return (((days % SYNODIC) / SYNODIC) + 1) % 1;
}

/** Part éclairée du disque (0 à 1). */
export function moonLit(phase: number): number {
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/**
 * Le `d` SVG de la partie éclairée d'une lune de rayon r centrée en (cx, cy) : le limbe d'un
 * côté, le terminateur (demi-ellipse) de l'autre. Croissante éclairée à droite (hémisphère nord).
 */
export function moonLitPath(cx: number, cy: number, r: number, phase: number): string {
  const waxing = phase < 0.5;
  const crescent = phase < 0.25 || phase > 0.75;
  const rx = Math.abs(Math.cos(2 * Math.PI * phase)) * r;
  const limb = waxing ? 1 : 0;
  const term = waxing ? (crescent ? 0 : 1) : crescent ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M${f(cx)} ${f(cy - r)} A${f(r)} ${f(r)} 0 0 ${limb} ${f(cx)} ${f(cy + r)} A${f(rx)} ${f(r)} 0 0 ${term} ${f(cx)} ${f(cy - r)} Z`;
}

/** L'arc d'un astre levé à `rise` h et couché à `rise + 12` h : position à l'heure h. */
function arc(h: number, rise: number): SkyBody {
  const f = (((h - rise) % 24) + 24) % 24 / 12;
  return { x: 0.08 + f * 0.84, alt: Math.max(0, Math.sin(f * Math.PI)) };
}

/** Le ciel à la date donnée (heure locale) et dans la saison donnée. */
export function skyAt(d: Date, season: Season): SkyState {
  const h = d.getHours() + d.getMinutes() / 60;
  const time: SkyTime = h >= 5 && h < 7 ? "dawn" : h >= 7 && h < 17 ? "day" : h >= 17 && h < 19 ? "dusk" : "night";
  const night = time === "night";
  const state: SkyState = {
    time,
    stars: night,
    mist: h >= 5 && h < 10,
    petals: season === "spring" && !night,
    fireflies: season === "summer" && night,
  };
  if (night) state.moon = { ...arc(h, 19), phase: moonPhase(d) };
  // À l'aube et au crépuscule, le soleil est sur l'horizon, à demi caché derrière la crête.
  else if (time === "dawn") state.sun = { x: 0.16, alt: 0 };
  else if (time === "dusk") state.sun = { x: 0.84, alt: 0 };
  else state.sun = arc(h, 6);
  if (!night) {
    if (season === "spring") state.birds = "swallows";
    else if (season === "autumn") state.birds = "geese";
    else if (season === "winter") state.birds = "crane";
  }
  return state;
}
