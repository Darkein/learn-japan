// Une route par niveau JLPT : à chaque niveau terminé, le voyageur repart de zéro sur une
// nouvelle route — la longueur suit le volume du niveau, la couleur du train change.
// Les trois premières sont des Cinq Routes d'Edo (toutes partent de Nihonbashi) ; les deux
// dernières, des pèlerinages : le voyage de Bashō, puis les 88 temples de Shikoku.

import type { TokaidoStation } from "./tokaido";
import { TOKAIDO } from "./tokaido";
import { KOSHU_KAIDO } from "./koshu";
import { NAKASENDO } from "./nakasendo";
import { OKU_NO_HOSOMICHI } from "./okunohosomichi";
import { SHIKOKU_HENRO } from "./shikoku";

export interface Route {
  /** Niveau JLPT auquel la route correspond (5 = N5 … 1 = N1). */
  level: number;
  name: string;
  kanji: string;
  /** « Edo → Kyōto, par la côte » — affiché en sous-titre de la route. */
  tagline: string;
  /** Nom du terme, pour « X atteint — la route est faite ». */
  arriveFr: string;
  /** Couleur du train sur cette route (valeur CSS). */
  trainColor: string;
  stations: TokaidoStation[];
}

/** Dans l'ordre du voyage : N5 d'abord. */
export const ROUTES: Route[] = [
  {
    level: 5,
    name: "Tōkaidō",
    kanji: "東海道",
    tagline: "Edo → Kyōto, par la côte",
    arriveFr: "Kyōto",
    trainColor: "var(--accent)",
    stations: TOKAIDO,
  },
  {
    level: 4,
    name: "Kōshū Kaidō",
    kanji: "甲州街道",
    tagline: "Edo → Shimosuwa, par les monts de Kai",
    arriveFr: "Shimosuwa",
    trainColor: "var(--accent-2)",
    stations: KOSHU_KAIDO,
  },
  {
    level: 3,
    name: "Nakasendō",
    kanji: "中山道",
    tagline: "Edo → Kyōto, par la montagne",
    arriveFr: "Kyōto",
    trainColor: "#3f7d5a",
    stations: NAKASENDO,
  },
  {
    level: 2,
    name: "Oku no Hosomichi",
    kanji: "おくのほそ道",
    tagline: "Vers le Nord profond, sur les pas de Bashō",
    arriveFr: "Ōgaki",
    trainColor: "#c9972b",
    stations: OKU_NO_HOSOMICHI,
  },
  {
    level: 1,
    name: "Shikoku henro",
    kanji: "四国遍路",
    tagline: "Les 88 temples, sur les pas de Kūkai",
    arriveFr: "Ōkubo-ji",
    trainColor: "#7a5ea6",
    stations: SHIKOKU_HENRO,
  },
];

export function routeForLevel(level: number): Route {
  const route = ROUTES.find((r) => r.level === level);
  if (!route) throw new Error(`Pas de route pour le niveau ${level}`);
  return route;
}
