// Les étapes d'Oku no Hosomichi (おくのほそ道), le voyage de Bashō vers le Nord profond (1689).
// 38 points au total : index 0 = départ (Fukagawa, Edo), 37 = Ōgaki, où le récit s'achève.
// Sélection curatée des lieux réels du périple, dans l'ordre du récit.
// Source : https://en.wikipedia.org/wiki/Oku_no_Hosomichi

import type { TokaidoStation } from "./tokaido";

export const OKU_NO_HOSOMICHI: TokaidoStation[] = [
  { index: 0, kanji: "深川", romaji: "Fukagawa", note: "Bashō vend sa maison au bord de la Sumida avant de partir : « même ma cabane d'herbe changera d'habitants — maison de poupées ». Ton voyage vers le Nord commence ici." },
  { index: 1, kanji: "千住", romaji: "Senju", note: "Les vrais adieux : « le printemps s'en va — les oiseaux crient, larmes aux yeux des poissons »." },
  { index: 2, kanji: "草加", romaji: "Sōka" },
  { index: 3, kanji: "日光", romaji: "Nikkō", note: "Devant les sanctuaires des Tokugawa : « ô vénérable — sur les feuilles vertes, les jeunes feuilles, la lumière du soleil »." },
  { index: 4, kanji: "黒羽", romaji: "Kurobane" },
  { index: 5, kanji: "殺生石", romaji: "Sesshōseki", note: "La « pierre qui tue » de Nasu, dont les vapeurs sulfureuses foudroyaient, dit-on, insectes et oiseaux." },
  { index: 6, kanji: "芦野", romaji: "Ashino" },
  { index: 7, kanji: "白河の関", romaji: "Shirakawa no Seki", note: "L'ancienne barrière de Shirakawa : la porte du Nord profond, tant chantée par les poètes. Le vrai voyage commence." },
  { index: 8, kanji: "須賀川", romaji: "Sukagawa" },
  { index: 9, kanji: "飯塚", romaji: "Iizuka" },
  { index: 10, kanji: "仙台", romaji: "Sendai" },
  { index: 11, kanji: "多賀城", romaji: "Tagajō", note: "Devant la stèle millénaire de Tsubo, Bashō pleure : enfin un monument que le temps n'a pas effacé." },
  { index: 12, kanji: "塩竈", romaji: "Shiogama" },
  { index: 13, kanji: "松島", romaji: "Matsushima", note: "La baie aux pins, l'un des trois plus beaux paysages du Japon — Bashō, saisi, renonce à écrire un haïku." },
  { index: 14, kanji: "石巻", romaji: "Ishinomaki" },
  { index: 15, kanji: "平泉", romaji: "Hiraizumi", note: "Sur les ruines de la gloire des Fujiwara : « herbes de l'été — des rêves de guerriers voilà les restes »." },
  { index: 16, kanji: "鳴子", romaji: "Naruko" },
  { index: 17, kanji: "尾花沢", romaji: "Obanazawa" },
  { index: 18, kanji: "立石寺", romaji: "Yamadera", note: "Au temple Ryūshaku-ji accroché à la falaise : « silence — le chant des cigales pénètre les rocs »." },
  { index: 19, kanji: "大石田", romaji: "Ōishida", note: "Bashō descend la Mogami en bateau : « rassemblant les pluies de mai, rapide — la Mogami »." },
  { index: 20, kanji: "羽黒山", romaji: "Haguro-san" },
  { index: 21, kanji: "月山", romaji: "Gassan", note: "L'ascension de la « montagne de la lune », dans les nuages et la neige d'été." },
  { index: 22, kanji: "湯殿山", romaji: "Yudono-san", note: "Le sanctuaire dont il est interdit de parler : « de Yudono, je ne dirai rien — mais mes manches sont trempées de larmes »." },
  { index: 23, kanji: "鶴岡", romaji: "Tsuruoka" },
  { index: 24, kanji: "酒田", romaji: "Sakata", note: "Le port où la Mogami « verse le jour brûlant dans la mer »." },
  { index: 25, kanji: "象潟", romaji: "Kisakata", note: "Le point le plus au nord du voyage : la lagune sous la pluie, belle « comme Xi Shi endormie »." },
  { index: 26, kanji: "村上", romaji: "Murakami" },
  { index: 27, kanji: "新潟", romaji: "Niigata" },
  { index: 28, kanji: "出雲崎", romaji: "Izumozaki", note: "Face à l'île des exilés : « mer démontée — s'étirant jusqu'à Sado, la Voie lactée »." },
  { index: 29, kanji: "市振", romaji: "Ichiburi", note: "À l'auberge, deux courtisanes en pèlerinage : « sous le même toit dorment courtisanes et moine — lespédèzes et lune »." },
  { index: 30, kanji: "金沢", romaji: "Kanazawa", note: "Bashō pleure le jeune poète Isshō, mort avant son passage : « remue-toi, tombeau ! ma voix qui pleure est le vent d'automne »." },
  { index: 31, kanji: "小松", romaji: "Komatsu", note: "Devant le casque du vieux guerrier Sanemori : « pitié ! sous le casque, un grillon »." },
  { index: 32, kanji: "那谷寺", romaji: "Natadera" },
  { index: 33, kanji: "山中温泉", romaji: "Yamanaka Onsen", note: "Aux eaux de Yamanaka, Sora, malade, quitte Bashō — le compagnon de toute la route s'en va devant." },
  { index: 34, kanji: "福井", romaji: "Fukui" },
  { index: 35, kanji: "敦賀", romaji: "Tsuruga", note: "Venu pour la pleine lune du port : « lune des moissons — le temps du Nord est si changeant »." },
  { index: 36, kanji: "色の浜", romaji: "Iro no Hama" },
  { index: 37, kanji: "大垣", romaji: "Ōgaki", note: "Le récit s'achève ici, entouré d'amis — et Bashō repart déjà pour Ise : « comme la palourde de sa coquille, on s'arrache l'un à l'autre — l'automne s'en va »." },
];
