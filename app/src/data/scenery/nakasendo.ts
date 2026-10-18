// Le décor réel du Nakasendō (SPEC §5c.6), d'après la géographie et les estampes d'Eisen et
// d'Hiroshige (« Les 69 stations du Kisokaidō ») : une entrée par station, avec le tronçon
// qui y mène.

import type { CityScenery, RouteScenery } from "../../lib/scenery";

const c = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => ({ kana, ...o });

export const NAKASENDO_SCENERY: RouteScenery = {
  level: 3,
  cities: [
    /* 0 */ c("にほんばし", { motif: "bridge", unique: "edo" }),
    /* 1 */ c("いたばし", { motif: "bridge", biome: "town", marks: [{ kind: "bridge" }] }),
    // Le bac de Toda, sur l'Ara.
    /* 2 */ c("わらび", { size: "village", motif: "boat", biome: "river", crossing: "ferry" }),
    /* 3 */ c("うらわ", { size: "village", motif: "rice", biome: "rice", relief: "plain" }),
    // Le sanctuaire Hikawa.
    /* 4 */ c("おおみや", { motif: "shrine", biome: "rice", marks: [{ kind: "torii" }, { kind: "shrine" }] }),
    /* 5 */ c("あげお", { size: "village", biome: "rice", relief: "plain" }),
    /* 6 */ c("おけがわ", { size: "village", biome: "rice", relief: "plain" }),
    /* 7 */ c("こうのす", { biome: "rice" }),
    /* 8 */ c("くまがや", { biome: "plain", marks: [{ kind: "temple" }] }),
    /* 9 */ c("ふかや", { biome: "plain" }),
    // La plus grande station de la route.
    /* 10 */ c("ほんじょう", { size: "grande", motif: "town", biome: "town", marks: [{ kind: "kura" }] }),
    /* 11 */ c("しんまち", { size: "village", biome: "river" }),
    // Le port fluvial de la Karasu.
    /* 12 */ c("くらがの", { size: "village", motif: "boat", biome: "river", marks: [{ kind: "boats" }] }),
    /* 13 */ c("たかさき", { size: "grande", motif: "castle", biome: "plain", marks: [{ kind: "castle" }] }),
    /* 14 */ c("いたはな", { size: "village", biome: "river" }),
    /* 15 */ c("あんなか", { motif: "castle", biome: "plain" }),
    /* 16 */ c("まついだ", { size: "village", biome: "mountain" }),
    // Le poste de contrôle d'Usui, au pied du col.
    /* 17 */ c("さかもと", { size: "village", motif: "gate", biome: "mountain", marks: [{ kind: "gate" }] }),
    // Le col d'Usui, et l'Asama qui fume.
    /* 18 */ c("かるいざわ", { size: "village", motif: "mountain", biome: "mountain", relief: "pass", unique: "usui-asama" }),
    /* 19 */ c("くつかけ", { size: "village", biome: "forest", marks: [{ kind: "volcano", far: true }] }),
    // La bifurcation vers Hokkoku Kaidō.
    /* 20 */ c("おいわけ", { size: "village", motif: "mountain", biome: "forest", marks: [{ kind: "signpost" }] }),
    /* 21 */ c("おたい", { size: "village", biome: "plain" }),
    /* 22 */ c("いわむらだ", { size: "village", biome: "rice" }),
    // La Chikuma.
    /* 23 */ c("しおなだ", { size: "village", biome: "river", crossing: "bridge" }),
    /* 24 */ c("やわた", { size: "village", motif: "shrine", biome: "rice", marks: [{ kind: "shrine" }] }),
    /* 25 */ c("もちづき", { size: "village", motif: "pine", biome: "forest" }),
    /* 26 */ c("あしだ", { size: "village", biome: "forest" }),
    /* 27 */ c("ながくぼ", { size: "village", biome: "river" }),
    /* 28 */ c("わだ", { size: "village", biome: "mountain" }),
    // Le col de Wada, le plus haut de la route ; les sources chaudes et le grand sanctuaire.
    /* 29 */ c("しもすわ", { motif: "shrine", biome: "mountain", relief: "pass", marks: [{ kind: "onsen" }, { kind: "shrine" }] }),
    // Le col de Shiojiri, au-dessus du lac Suwa.
    /* 30 */ c("しおじり", { motif: "lake", biome: "lake", relief: "pass", marks: [{ kind: "lake" }] }),
    /* 31 */ c("せば", { size: "village", biome: "river" }),
    /* 32 */ c("もとやま", { size: "village", biome: "forest" }),
    // L'entrée de la vallée du Kiso, et son poste de contrôle.
    /* 33 */ c("にえかわ", { size: "village", motif: "gate", biome: "forest", marks: [{ kind: "gate" }] }),
    /* 34 */ c("ならい", { motif: "town", biome: "forest", marks: [{ kind: "town" }] }),
    // Le col de Torii.
    /* 35 */ c("やぶはら", { size: "village", biome: "forest", relief: "pass", marks: [{ kind: "torii" }] }),
    /* 36 */ c("みやのこし", { size: "village", biome: "forest" }),
    // Le poste de contrôle de Kiso-Fukushima.
    /* 37 */ c("ふくしま", { motif: "gate", biome: "forest", marks: [{ kind: "gate" }] }),
    // Les gorges de Nezame no Toko.
    /* 38 */ c("あげまつ", { size: "village", motif: "wave", biome: "river", marks: [{ kind: "waterfall" }] }),
    /* 39 */ c("すはら", { size: "village", biome: "forest" }),
    /* 40 */ c("のじり", { size: "village", biome: "forest" }),
    /* 41 */ c("みどの", { size: "village", biome: "forest" }),
    /* 42 */ c("つまご", { size: "village", motif: "town", biome: "forest", marks: [{ kind: "town" }] }),
    // Le col de Magome, entre Tsumago et Magome.
    /* 43 */ c("まごめ", { size: "village", motif: "town", biome: "forest", relief: "pass", unique: "kiso" }),
    /* 44 */ c("おちあい", { size: "village", biome: "forest" }),
    /* 45 */ c("なかつがわ", { biome: "plain" }),
    /* 46 */ c("おおい", { size: "village", biome: "forest" }),
    /* 47 */ c("おおくて", { size: "village", biome: "forest", relief: "pass" }),
    /* 48 */ c("ほそくて", { size: "village", biome: "forest" }),
    /* 49 */ c("みたけ", { size: "village", motif: "temple", biome: "forest", marks: [{ kind: "temple" }] }),
    /* 50 */ c("ふしみ", { size: "village", biome: "rice" }),
    // Le bac d'Ōta, sur le Kiso.
    /* 51 */ c("おおた", { size: "village", motif: "boat", biome: "river", crossing: "ferry" }),
    // Le château d'Inuyama, de l'autre côté du fleuve.
    /* 52 */ c("うぬま", { size: "village", motif: "castle", biome: "river", marks: [{ kind: "castle" }] }),
    /* 53 */ c("かのう", { size: "grande", motif: "castle", biome: "plain", marks: [{ kind: "castle" }] }),
    // Le bac du Nagara.
    /* 54 */ c("ごうど", { size: "village", biome: "river", crossing: "ferry" }),
    /* 55 */ c("みえじ", { size: "village", motif: "temple", biome: "rice", marks: [{ kind: "temple" }] }),
    /* 56 */ c("あかさか", { size: "village", biome: "rice" }),
    /* 57 */ c("たるい", { size: "village", biome: "plain" }),
    /* 58 */ c("せきがはら", { size: "village", motif: "mountain", biome: "plain" }),
    /* 59 */ c("います", { size: "village", biome: "forest" }),
    /* 60 */ c("かしわばら", { size: "village", biome: "forest" }),
    // L'eau claire des sources de Samegai.
    /* 61 */ c("さめがい", { size: "village", motif: "wave", biome: "river" }),
    /* 62 */ c("ばんば", { size: "village", biome: "forest" }),
    /* 63 */ c("とりいもと", { size: "village", biome: "plain" }),
    // Le grand torii du sanctuaire de Taga.
    /* 64 */ c("たかみや", { size: "village", motif: "shrine", biome: "rice", marks: [{ kind: "torii" }] }),
    /* 65 */ c("えちがわ", { size: "village", motif: "bridge", biome: "river", crossing: "bridge" }),
    /* 66 */ c("むさ", { size: "village", biome: "rice" }),
    /* 67 */ c("もりやま", { size: "village", biome: "rice" }),
    /* 68 */ c("くさつ", { biome: "plain", marks: [{ kind: "signpost" }] }),
    // Le lac Biwa.
    /* 69 */ c("おおつ", { size: "grande", motif: "lake", biome: "lake", unique: "biwa" }),
    /* 70 */ c("さんじょうおおはし", { motif: "bridge", biome: "town", unique: "kyoto" }),
  ],
};
