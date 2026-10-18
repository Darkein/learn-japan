// Le décor réel du Kōshū Kaidō (SPEC §5c.6) : d'Edo aux monts de Kai et au lac Suwa, une
// entrée par station, avec le tronçon qui y mène.

import type { CityScenery, RouteScenery } from "../../lib/scenery";

const c = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => ({ kana, ...o });

export const KOSHU_SCENERY: RouteScenery = {
  level: 4,
  cities: [
    /* 0 */ c("にほんばし", { motif: "bridge", unique: "edo" }),
    /* 1 */ c("ないとうしんじゅく", { size: "grande", motif: "town", biome: "town", marks: [{ kind: "roofs" }] }),
    /* 2 */ c("しもたかいど", { size: "village", biome: "plain" }),
    /* 3 */ c("かみたかいど", { size: "village", biome: "plain" }),
    /* 4 */ c("こくりょう", { size: "village", motif: "rice", biome: "rice" }),
    /* 5 */ c("しもふだ", { size: "village", biome: "rice" }),
    /* 6 */ c("かみふだ", { size: "village", biome: "rice" }),
    /* 7 */ c("しもいしはら", { size: "village", biome: "plain" }),
    /* 8 */ c("かみいしはら", { size: "village", biome: "plain" }),
    // Le sanctuaire d'Ōkunitama.
    /* 9 */ c("ふちゅう", { motif: "shrine", biome: "plain", marks: [{ kind: "torii" }, { kind: "shrine" }] }),
    // Le bac de Hino, sur la Tama.
    /* 10 */ c("ひの", { size: "village", motif: "boat", biome: "river", crossing: "ferry" }),
    /* 11 */ c("はちおうじ", { size: "grande", motif: "town", biome: "town", marks: [{ kind: "kura" }] }),
    // Le poste de contrôle de Kobotoke, à Komagino.
    /* 12 */ c("こまぎの", { size: "village", motif: "gate", biome: "mountain", marks: [{ kind: "gate" }] }),
    /* 13 */ c("こぼとけ", { size: "village", motif: "mountain", biome: "mountain" }),
    // Le col de Kobotoke.
    /* 14 */ c("おばら", { size: "village", motif: "mountain", biome: "mountain", relief: "pass" }),
    // La vallée de la Sagami.
    /* 15 */ c("よせ", { size: "village", biome: "river" }),
    /* 16 */ c("よしの", { size: "village", biome: "river" }),
    /* 17 */ c("せきの", { size: "village", biome: "forest" }),
    /* 18 */ c("うえのはら", { biome: "forest" }),
    // Le gué de la Tsuru.
    /* 19 */ c("つるかわ", { size: "village", biome: "river", crossing: "ford" }),
    /* 20 */ c("のたじり", { size: "village", biome: "mountain", relief: "pass" }),
    // Le col d'Inume, et le Fuji qu'y peignit Hokusai.
    /* 21 */ c("いぬめ", { size: "village", motif: "fuji", biome: "mountain", relief: "pass", marks: [{ kind: "fuji", far: true }] }),
    /* 22 */ c("しもとりさわ", { size: "village", biome: "forest" }),
    /* 23 */ c("かみとりさわ", { size: "village", biome: "forest" }),
    // Le pont-singe au-dessus des gorges de la Katsura.
    /* 24 */ c("さるはし", { size: "village", motif: "bridge", biome: "river", crossing: "bridge", unique: "saruhashi" }),
    /* 25 */ c("こまはし", { size: "village", biome: "river" }),
    // Le mont Iwadono.
    /* 26 */ c("おおつき", { motif: "mountain", biome: "mountain", marks: [{ kind: "ridge", far: true }] }),
    /* 27 */ c("しもはなさき", { size: "village", biome: "forest" }),
    /* 28 */ c("かみはなさき", { size: "village", biome: "forest" }),
    /* 29 */ c("しもはつかり", { size: "village", biome: "mountain" }),
    /* 30 */ c("なかはつかり", { size: "village", biome: "mountain" }),
    /* 31 */ c("しらの", { size: "village", biome: "mountain" }),
    /* 32 */ c("くろのだ", { size: "village", biome: "mountain" }),
    // Le col de Sasago, le plus haut de la route.
    /* 33 */ c("こまかい", { size: "village", motif: "mountain", biome: "mountain", relief: "pass" }),
    /* 34 */ c("つるせ", { size: "village", motif: "gate", biome: "mountain", marks: [{ kind: "gate" }] }),
    // Le bassin de Kai : ses vignes, et le Fuji par-dessus les monts.
    /* 35 */ c("かつぬま", { size: "village", motif: "fuji", biome: "vineyard", unique: "kai" }),
    /* 36 */ c("くりはら", { size: "village", biome: "orchard" }),
    /* 37 */ c("いさわ", { size: "village", biome: "orchard" }),
    // Le château de Kōfu.
    /* 38 */ c("こうふ", { size: "grande", motif: "castle", biome: "plain", marks: [{ kind: "castle" }] }),
    /* 39 */ c("にらさき", { biome: "rice" }),
    /* 40 */ c("だいがはら", { size: "village", biome: "forest" }),
    /* 41 */ c("きょうらいし", { size: "village", motif: "mountain", biome: "mountain" }),
    /* 42 */ c("つたき", { size: "village", biome: "forest" }),
    /* 43 */ c("かなざわ", { size: "village", biome: "mountain" }),
    // Le lac Suwa et le château de Takashima.
    /* 44 */ c("かみすわ", { motif: "lake", biome: "lake", unique: "suwa" }),
    // Le grand sanctuaire de Suwa.
    /* 45 */ c("しもすわ", { motif: "shrine", biome: "lake", marks: [{ kind: "torii" }, { kind: "shrine" }] }),
  ],
};
