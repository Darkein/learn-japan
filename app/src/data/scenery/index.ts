// Le décor réel de chaque route (SPEC §5c.6) : tailles des villes, lectures, motifs des
// tampons, repères, paysages et reliefs des tronçons, traversées, illustrations uniques.

import type { RouteScenery } from "../../lib/scenery";
import { KOSHU_SCENERY } from "./koshu";
import { NAKASENDO_SCENERY } from "./nakasendo";
import { OKU_SCENERY } from "./okunohosomichi";
import { SHIKOKU_SCENERY } from "./shikoku";
import { TOKAIDO_SCENERY } from "./tokaido";

export const SCENERIES: RouteScenery[] = [TOKAIDO_SCENERY, KOSHU_SCENERY, NAKASENDO_SCENERY, OKU_SCENERY, SHIKOKU_SCENERY];
