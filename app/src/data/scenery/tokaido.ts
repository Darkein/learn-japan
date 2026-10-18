// Le décor réel du Tōkaidō (SPEC §5c.6), d'après la géographie et les estampes d'Hiroshige
// (« Les 53 stations du Tōkaidō ») : une entrée par station, avec le tronçon qui y mène.

import type { CityScenery, RouteScenery } from "../../lib/scenery";

const c = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => ({ kana, ...o });

export const TOKAIDO_SCENERY: RouteScenery = {
  level: 5,
  cities: [
    /* 0 */ c("にほんばし", { motif: "bridge", unique: "edo" }),
    /* 1 */ c("しながわ", { motif: "wave", biome: "coast", marks: [{ kind: "boats" }] }),
    // Le bac de Rokugō, sur la rivière Tama.
    /* 2 */ c("かわさき", { motif: "boat", biome: "river", crossing: "ferry" }),
    /* 3 */ c("かながわ", { motif: "wave", biome: "coast", marks: [{ kind: "teahouse" }, { kind: "boats" }] }),
    // Le pont de Shinmachi, à l'entrée de Hodogaya.
    /* 4 */ c("ほどがや", { motif: "bridge", biome: "plain", marks: [{ kind: "bridge" }] }),
    /* 5 */ c("とつか", { biome: "rice", marks: [{ kind: "signpost" }] }),
    // Le Yugyō-ji et le torii de la route d'Enoshima.
    /* 6 */ c("ふじさわ", { motif: "temple", biome: "plain", crossing: "bridge", marks: [{ kind: "temple" }, { kind: "torii" }] }),
    // Le mont Kōrai, en pain de sucre.
    /* 7 */ c("ひらつか", { motif: "mountain", biome: "rice", marks: [{ kind: "ridge", far: true }] }),
    /* 8 */ c("おおいそ", { size: "village", motif: "wave", biome: "coast", marks: [{ kind: "pines" }] }),
    // Le gué de la Sakawa, puis le château au pied des monts Hakone.
    /* 9 */ c("おだわら", { size: "grande", motif: "castle", biome: "river", crossing: "ford", marks: [{ kind: "castle" }] }),
    // Le col : le lac Ashi, le torii dans l'eau, le poste de contrôle.
    /* 10 */ c("はこね", { size: "village", motif: "gate", biome: "mountain", relief: "pass", unique: "hakone" }),
    /* 11 */ c("みしま", { motif: "shrine", biome: "mountain", relief: "pass", marks: [{ kind: "torii" }, { kind: "shrine" }] }),
    // Les mille pins de Senbon Matsubara.
    /* 12 */ c("ぬまづ", { motif: "pine", biome: "coast", marks: [{ kind: "pines" }, { kind: "pines" }] }),
    // Le Fuji vu des marais d'Ukishima, plus grand que l'estampe.
    /* 13 */ c("はら", { size: "village", motif: "fuji", biome: "rice", relief: "plain", unique: "fuji-hara" }),
    // Le « Fuji à gauche » au bout de l'allée de pins.
    /* 14 */ c("よしわら", { motif: "pine", biome: "rice", relief: "plain", marks: [{ kind: "pines" }, { kind: "fuji", far: true }] }),
    // Le bac de la Fuji ; Kanbara reste sous la neige du soir.
    /* 15 */ c("かんばら", { size: "village", motif: "mountain", biome: "river", crossing: "ferry", forced: "snow" }),
    /* 16 */ c("ゆい", { size: "village", motif: "wave", biome: "coast" }),
    // Le col de Satta, le Fuji au-dessus de la baie de Suruga.
    /* 17 */ c("おきつ", { size: "village", motif: "wave", biome: "coast", relief: "pass", unique: "fuji-satta" }),
    // Le port de Shimizu et la pinède de Miho.
    /* 18 */ c("えじり", { motif: "boat", biome: "coast", marks: [{ kind: "boats" }, { kind: "pines" }] }),
    // Le gué de l'Abe et le château de Sunpu.
    /* 19 */ c("ふちゅう", { size: "grande", motif: "castle", biome: "river", crossing: "ford", marks: [{ kind: "castle" }] }),
    // La maison de thé de la soupe d'igname.
    /* 20 */ c("まりこ", { size: "village", motif: "tea", biome: "tea", marks: [{ kind: "teahouse" }] }),
    // Le col d'Utsunoya.
    /* 21 */ c("おかべ", { size: "village", motif: "mountain", biome: "mountain", relief: "pass" }),
    /* 22 */ c("ふじえだ", { biome: "tea" }),
    /* 23 */ c("しまだ", { biome: "river" }),
    // Le gué de l'Ōi, à dos de porteurs.
    /* 24 */ c("かなや", { size: "village", motif: "tea", biome: "river", crossing: "ford", unique: "oi-ford" }),
    // Le col de Sayo no Nakayama et sa pierre qui pleure la nuit.
    /* 25 */ c("にっさか", { size: "village", motif: "mountain", biome: "tea", relief: "pass", marks: [{ kind: "jizo" }] }),
    // Le pont d'Ōike et le château.
    /* 26 */ c("かけがわ", { motif: "castle", biome: "tea", crossing: "bridge", marks: [{ kind: "castle" }] }),
    /* 27 */ c("ふくろい", { size: "village", motif: "tea", biome: "rice", marks: [{ kind: "teahouse" }] }),
    /* 28 */ c("みつけ", { motif: "boat", biome: "rice" }),
    // Le bac du Tenryū, puis le château de Hamamatsu.
    /* 29 */ c("はままつ", { size: "grande", motif: "castle", biome: "river", crossing: "ferry", marks: [{ kind: "castle" }] }),
    /* 30 */ c("まいさか", { size: "village", motif: "wave", biome: "coast", marks: [{ kind: "boats" }] }),
    // La traversée du lac Hamana en bateau, jusqu'au poste de contrôle d'Arai.
    /* 31 */ c("あらい", { motif: "gate", biome: "lake", crossing: "ferry", unique: "hamana", marks: [{ kind: "gate" }] }),
    /* 32 */ c("しらすか", { size: "village", motif: "wave", biome: "coast" }),
    /* 33 */ c("ふたがわ", { size: "village", motif: "pine", biome: "plain" }),
    // Le pont de Toyohashi et le château de Yoshida.
    /* 34 */ c("よしだ", { motif: "castle", biome: "river", crossing: "bridge", marks: [{ kind: "castle" }] }),
    // L'allée de pins de Goyu.
    /* 35 */ c("ごゆ", { size: "village", motif: "pine", biome: "plain", relief: "plain", marks: [{ kind: "pines" }] }),
    /* 36 */ c("あかさか", { size: "village", biome: "plain" }),
    /* 37 */ c("ふじかわ", { size: "village", motif: "gate", biome: "plain", marks: [{ kind: "gate" }] }),
    // Le pont de Yahagi, le plus long de la route, et le château d'Okazaki.
    /* 38 */ c("おかざき", { size: "grande", motif: "castle", biome: "river", crossing: "bridge", marks: [{ kind: "castle" }] }),
    /* 39 */ c("ちりゅう", { size: "village", motif: "pine", biome: "plain", relief: "plain" }),
    /* 40 */ c("なるみ", { size: "village", biome: "plain", marks: [{ kind: "kura" }] }),
    // Le sanctuaire d'Atsuta.
    /* 41 */ c("みや", { size: "grande", motif: "shrine", biome: "town", marks: [{ kind: "torii" }, { kind: "shrine" }] }),
    // La traversée des sept ri, en mer, jusqu'au château de Kuwana.
    /* 42 */ c("くわな", { motif: "castle", biome: "coast", crossing: "ferry", unique: "miya-ferry", marks: [{ kind: "castle" }] }),
    /* 43 */ c("よっかいち", { motif: "bridge", biome: "coast", crossing: "bridge" }),
    /* 44 */ c("いしやくし", { size: "village", motif: "temple", biome: "rice", marks: [{ kind: "temple" }] }),
    // Shōno reste sous l'averse.
    /* 45 */ c("しょうの", { size: "village", motif: "pine", biome: "forest", forced: "rain" }),
    /* 46 */ c("かめやま", { motif: "castle", biome: "mountain", marks: [{ kind: "castle" }] }),
    /* 47 */ c("せき", { motif: "gate", biome: "mountain", marks: [{ kind: "gate" }] }),
    // Le mont Fudesute.
    /* 48 */ c("さかのした", { size: "village", motif: "mountain", biome: "mountain", marks: [{ kind: "ridge", far: true }] }),
    // Le col de Suzuka.
    /* 49 */ c("つちやま", { size: "village", motif: "mountain", biome: "forest", relief: "pass" }),
    /* 50 */ c("みなくち", { size: "village", biome: "plain" }),
    /* 51 */ c("いしべ", { size: "village", biome: "rice" }),
    // La bifurcation avec le Nakasendō.
    /* 52 */ c("くさつ", { biome: "plain", marks: [{ kind: "signpost" }] }),
    // Le lac Biwa.
    /* 53 */ c("おおつ", { size: "grande", motif: "lake", biome: "lake", marks: [{ kind: "boats" }] }),
    // Le col d'Ōsaka, puis Kyōto : le pont de Sanjō et la pagode.
    /* 54 */ c("さんじょうおおはし", { motif: "bridge", biome: "town", unique: "kyoto" }),
  ],
};
