// Le décor réel de l'Oku no Hosomichi (SPEC §5c.6), sur les pas de Bashō (1689) : une entrée
// par étape, avec le tronçon qui y mène.

import type { CityScenery, RouteScenery } from "../../lib/scenery";

const c = (kana: string, o: Omit<CityScenery, "kana"> = {}): CityScenery => ({ kana, ...o });

export const OKU_SCENERY: RouteScenery = {
  level: 2,
  cities: [
    // L'ermitage du bananier, d'où Bashō part en barque sur la Sumida.
    /* 0 */ c("ふかがわ", { motif: "boat", unique: "fukagawa" }),
    // Le grand pont de Senju, où il prend la route.
    /* 1 */ c("せんじゅ", { motif: "bridge", biome: "river", crossing: "bridge" }),
    // L'allée de pins de Sōka.
    /* 2 */ c("そうか", { size: "village", motif: "pine", biome: "rice", relief: "plain", marks: [{ kind: "pines" }] }),
    // Le Tōshō-gū et l'allée des cèdres.
    /* 3 */ c("にっこう", { motif: "shrine", biome: "forest", unique: "nikko" }),
    /* 4 */ c("くろばね", { size: "village", biome: "rice" }),
    // La pierre qui tue, dans les vapeurs de Nasu Yumoto.
    /* 5 */ c("せっしょうせき", { size: "village", glyph: "石", motif: "mountain", biome: "mountain", marks: [{ kind: "onsen" }] }),
    // Le saule de Yugyō.
    /* 6 */ c("あしの", { size: "village", motif: "pine", biome: "rice" }),
    // La barrière de Shirakawa, porte du Nord profond.
    /* 7 */ c("しらかわのせき", { size: "village", glyph: "関", motif: "gate", biome: "forest", marks: [{ kind: "gate" }] }),
    /* 8 */ c("すかがわ", { biome: "rice" }),
    // Les sources chaudes d'Iizaka.
    /* 9 */ c("いいづか", { size: "village", biome: "mountain", marks: [{ kind: "onsen" }] }),
    /* 10 */ c("せんだい", { size: "grande", motif: "castle", biome: "plain", marks: [{ kind: "castle" }] }),
    // La stèle de Tsubo no Ishibumi, au fort de Taga.
    /* 11 */ c("たがじょう", { size: "village", motif: "gate", biome: "plain" }),
    // Le sanctuaire de Shiogama, sur la baie.
    /* 12 */ c("しおがま", { motif: "shrine", biome: "coast", marks: [{ kind: "torii" }, { kind: "boats" }] }),
    // Les îles de pins de Matsushima.
    /* 13 */ c("まつしま", { size: "village", motif: "pine", biome: "coast", unique: "matsushima" }),
    /* 14 */ c("いしのまき", { motif: "boat", biome: "coast", marks: [{ kind: "boats" }] }),
    // Le Chūson-ji et son pavillon d'or.
    /* 15 */ c("ひらいずみ", { size: "village", motif: "temple", biome: "river", unique: "hiraizumi" }),
    // Les sources chaudes de Naruko.
    /* 16 */ c("なるこ", { size: "village", biome: "mountain", marks: [{ kind: "onsen" }] }),
    // Le col de Natagiri et la barrière de Shitomae.
    /* 17 */ c("おばなざわ", { size: "village", biome: "mountain", relief: "pass", marks: [{ kind: "gate" }] }),
    // Le temple accroché à la falaise.
    /* 18 */ c("りっしゃくじ", { size: "village", glyph: "寺", motif: "temple", biome: "mountain", unique: "yamadera" }),
    // Le port fluvial de la Mogami.
    /* 19 */ c("おおいしだ", { size: "village", motif: "boat", biome: "river", marks: [{ kind: "boats" }] }),
    // La pagode de Haguro dans les cèdres.
    /* 20 */ c("はぐろさん", { size: "village", glyph: "山", motif: "pagoda", biome: "forest", marks: [{ kind: "pagoda" }, { kind: "cedars" }] }),
    /* 21 */ c("がっさん", { size: "village", glyph: "山", motif: "mountain", biome: "mountain", relief: "pass", marks: [{ kind: "ridge", far: true }] }),
    /* 22 */ c("ゆどのさん", { size: "village", glyph: "山", motif: "shrine", biome: "mountain", relief: "pass", marks: [{ kind: "torii" }] }),
    /* 23 */ c("つるおか", { motif: "castle", biome: "rice", marks: [{ kind: "castle" }] }),
    // L'embouchure de la Mogami.
    /* 24 */ c("さかた", { motif: "boat", biome: "river", marks: [{ kind: "boats" }] }),
    // La lagune aux îles de Kisakata, sous le mont Chōkai.
    /* 25 */ c("きさかた", { size: "village", motif: "lake", biome: "coast", unique: "kisakata" }),
    /* 26 */ c("むらかみ", { motif: "castle", biome: "coast" }),
    /* 27 */ c("にいがた", { size: "grande", motif: "boat", biome: "coast", marks: [{ kind: "boats" }] }),
    // « Mer sauvage — jusqu'à Sado s'étend la Voie lactée. »
    /* 28 */ c("いずもざき", { size: "village", motif: "wave", biome: "coast", marks: [{ kind: "sea" }] }),
    // Les falaises d'Oyashirazu.
    /* 29 */ c("いちぶり", { size: "village", motif: "wave", biome: "coast", relief: "pass" }),
    /* 30 */ c("かなざわ", { size: "grande", motif: "castle", biome: "town", marks: [{ kind: "castle" }] }),
    /* 31 */ c("こまつ", { motif: "shrine", biome: "rice", marks: [{ kind: "shrine" }] }),
    /* 32 */ c("なたでら", { size: "village", glyph: "寺", motif: "temple", biome: "forest", marks: [{ kind: "temple" }] }),
    /* 33 */ c("やまなかおんせん", { size: "village", biome: "river", marks: [{ kind: "onsen" }] }),
    /* 34 */ c("ふくい", { biome: "plain" }),
    // Le grand torii du sanctuaire de Kehi.
    /* 35 */ c("つるが", { motif: "shrine", biome: "coast", marks: [{ kind: "torii" }] }),
    // La plage d'Iro, en barque.
    /* 36 */ c("いろのはま", { size: "village", glyph: "浜", motif: "wave", biome: "coast", crossing: "ferry" }),
    // Ōgaki, ses canaux, et Bashō qui repart en barque.
    /* 37 */ c("おおがき", { motif: "castle", biome: "river", unique: "ogaki" }),
  ],
};
