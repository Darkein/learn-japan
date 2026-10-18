// Le décor réel du pèlerinage de Shikoku (SPEC §5c.6) : les 88 temples, du détroit de Naruto à
// l'Ōkubo-ji, une entrée par temple, avec le tronçon qui y mène.

import type { CityScenery, RouteScenery } from "../../lib/scenery";

const c = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => ({ kana, glyph: "寺", ...o });
/** Un temple de montagne ou de campagne. */
const t = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => c(kana, { size: "village", motif: "temple", ...o });

export const SHIKOKU_SCENERY: RouteScenery = {
  level: 1,
  cities: [
    // Les tourbillons du détroit de Naruto, avant le premier temple.
    /* 0 */ c("りょうぜんじ", { motif: "temple", unique: "naruto" }),
    /* 1 */ t("ごくらくじ", { biome: "rice" }),
    /* 2 */ t("こんせんじ", { biome: "rice" }),
    /* 3 */ t("だいにちじ", { biome: "rice" }),
    /* 4 */ t("じぞうじ", { biome: "forest" }),
    /* 5 */ t("あんらくじ", { biome: "rice" }),
    /* 6 */ t("じゅうらくじ", { biome: "rice" }),
    /* 7 */ t("くまだにじ", { biome: "forest" }),
    /* 8 */ t("ほうりんじ", { biome: "rice" }),
    /* 9 */ t("きりはたじ", { biome: "forest" }),
    // Le Yoshino.
    /* 10 */ t("ふじいでら", { biome: "river", crossing: "bridge" }),
    // Le premier col difficile, « où tombent les pèlerins ».
    /* 11 */ t("しょうさんじ", { motif: "mountain", biome: "mountain", relief: "pass" }),
    /* 12 */ t("だいにちじ", { biome: "forest" }),
    /* 13 */ t("じょうらくじ", { biome: "rice" }),
    /* 14 */ t("あわこくぶんじ", { biome: "rice" }),
    /* 15 */ t("かんおんじ", { biome: "rice" }),
    /* 16 */ c("いどじ", { size: "ville", motif: "temple", biome: "town" }),
    /* 17 */ t("おんざんじ", { biome: "rice" }),
    /* 18 */ t("たつえじ", { biome: "rice" }),
    /* 19 */ t("かくりんじ", { biome: "mountain", relief: "pass" }),
    /* 20 */ t("たいりゅうじ", { biome: "mountain", relief: "pass" }),
    /* 21 */ t("びょうどうじ", { biome: "forest" }),
    /* 22 */ t("やくおうじ", { motif: "wave", biome: "coast" }),
    // La longue côte jusqu'au cap Muroto.
    /* 23 */ t("ほつみさきじ", { motif: "wave", biome: "coast", unique: "muroto" }),
    /* 24 */ t("しんしょうじ", { motif: "boat", biome: "coast", marks: [{ kind: "boats" }] }),
    /* 25 */ t("こんごうちょうじ", { biome: "coast" }),
    /* 26 */ t("こうのみねじ", { biome: "mountain", relief: "pass" }),
    /* 27 */ t("だいにちじ", { biome: "rice" }),
    /* 28 */ t("とさこくぶんじ", { biome: "rice" }),
    /* 29 */ t("ぜんらくじ", { biome: "plain" }),
    // La pagode du Chikurin-ji, au-dessus de Kōchi.
    /* 30 */ c("ちくりんじ", { size: "grande", motif: "pagoda", biome: "town", marks: [{ kind: "pagoda" }] }),
    /* 31 */ t("ぜんじぶじ", { motif: "wave", biome: "coast" }),
    // Le bac d'Urado.
    /* 32 */ t("せっけいじ", { biome: "coast", crossing: "ferry" }),
    /* 33 */ t("たねまじ", { biome: "rice" }),
    // La Niyodo.
    /* 34 */ t("きよたきじ", { biome: "river", crossing: "bridge" }),
    /* 35 */ t("しょうりゅうじ", { motif: "wave", biome: "coast" }),
    /* 36 */ t("いわもとじ", { biome: "forest" }),
    // Le cap Ashizuri.
    /* 37 */ t("こんごうふくじ", { motif: "wave", biome: "coast", marks: [{ kind: "sea" }] }),
    // La Shimanto.
    /* 38 */ t("えんこうじ", { biome: "river", crossing: "bridge" }),
    /* 39 */ t("かんじざいじ", { biome: "coast" }),
    /* 40 */ t("りゅうこうじ", { biome: "forest" }),
    /* 41 */ t("ぶつもくじ", { biome: "rice" }),
    /* 42 */ t("めいせきじ", { biome: "rice" }),
    /* 43 */ t("だいほうじ", { biome: "forest" }),
    // Le temple dans la falaise.
    /* 44 */ t("いわやじ", { motif: "mountain", biome: "mountain", relief: "pass" }),
    /* 45 */ t("じょうるりじ", { biome: "forest" }),
    /* 46 */ t("やさかじ", { biome: "rice" }),
    /* 47 */ t("さいりんじ", { biome: "rice" }),
    /* 48 */ t("じょうどじ", { biome: "rice" }),
    /* 49 */ t("はんたじ", { biome: "plain" }),
    // Matsuyama, et les bains de Dōgo à côté.
    /* 50 */ c("いしてじ", { size: "grande", motif: "temple", biome: "town", marks: [{ kind: "onsen" }] }),
    /* 51 */ t("たいさんじ", { biome: "plain" }),
    /* 52 */ t("えんみょうじ", { biome: "plain" }),
    /* 53 */ t("えんめいじ", { motif: "wave", biome: "coast" }),
    /* 54 */ c("なんこうぼう", { size: "ville", glyph: "坊", motif: "temple", biome: "town" }),
    /* 55 */ t("たいさんじ", { biome: "rice" }),
    /* 56 */ t("えいふくじ", { biome: "rice" }),
    /* 57 */ t("せんゆうじ", { biome: "forest" }),
    /* 58 */ t("いよこくぶんじ", { biome: "rice" }),
    /* 59 */ t("よこみねじ", { motif: "mountain", biome: "mountain", relief: "pass" }),
    /* 60 */ t("こうおんじ", { biome: "forest" }),
    /* 61 */ t("ほうじゅじ", { biome: "plain" }),
    /* 62 */ t("きちじょうじ", { biome: "plain" }),
    /* 63 */ t("まえがみじ", { biome: "forest" }),
    /* 64 */ t("さんかくじ", { biome: "mountain" }),
    // Le temple le plus haut, au-dessus des gorges d'Iya et de leur pont de lianes.
    /* 65 */ t("うんぺんじ", { motif: "mountain", biome: "mountain", relief: "pass", unique: "iya" }),
    /* 66 */ t("だいこうじ", { biome: "rice" }),
    /* 67 */ c("じんねいん", { size: "village", glyph: "院", motif: "temple", biome: "coast" }),
    /* 68 */ t("かんおんじ", { biome: "coast" }),
    /* 69 */ t("もとやまじ", { motif: "pagoda", biome: "rice", marks: [{ kind: "pagoda" }] }),
    /* 70 */ t("いやだにじ", { biome: "mountain" }),
    /* 71 */ t("まんだらじ", { biome: "rice" }),
    /* 72 */ t("しゅっしゃかじ", { biome: "rice" }),
    /* 73 */ t("こうやまじ", { biome: "rice" }),
    // Le lieu de naissance de Kūkai, et sa grande pagode.
    /* 74 */ c("ぜんつうじ", { size: "ville", motif: "pagoda", biome: "town", unique: "zentsuji" }),
    /* 75 */ t("こんぞうじ", { biome: "rice" }),
    /* 76 */ t("どうりゅうじ", { biome: "coast" }),
    /* 77 */ t("ごうしょうじ", { biome: "coast" }),
    /* 78 */ t("てんのうじ", { biome: "rice" }),
    /* 79 */ c("さぬきこくぶんじ", { size: "ville", motif: "temple", biome: "rice" }),
    /* 80 */ t("しろみねじ", { biome: "mountain", relief: "pass" }),
    /* 81 */ t("ねごろじ", { biome: "forest" }),
    /* 82 */ t("いちのみやじ", { biome: "rice" }),
    // Le plateau de Yashima, au-dessus de la mer intérieure.
    /* 83 */ c("やしまじ", { size: "ville", motif: "wave", biome: "coast" }),
    /* 84 */ t("やくりじ", { motif: "mountain", biome: "mountain" }),
    /* 85 */ t("しどじ", { motif: "pagoda", biome: "coast", marks: [{ kind: "pagoda" }] }),
    /* 86 */ t("ながおじ", { biome: "rice" }),
    // Le dernier temple, où les pèlerins laissent leur bâton.
    /* 87 */ c("おおくぼじ", { motif: "temple", biome: "mountain", relief: "pass", unique: "okuboji" }),
  ],
};
