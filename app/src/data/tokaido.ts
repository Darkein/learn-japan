// Les 53 stations du Tōkaidō (East Sea Road, Edo → Kyōto), célébrées par Hiroshige.
// 55 points au total : index 0 = départ (Nihonbashi, Edo), 1–53 = les stations,
// 54 = arrivée (Sanjō Ōhashi, Kyōto). Route du niveau N5 — une route par niveau JLPT
// (voir data/routes.ts) : le voyageur avance au rythme réel de son apprentissage
// (lib/tokaido.ts) puis repart de zéro sur la route suivante.

export interface TokaidoStation {
  /** Position sur la route, 0..54. */
  index: number;
  kanji: string;
  romaji: string;
  /** Fait bref (FR) affiché à l'arrivée à cette étape — pas obligatoire partout. */
  note?: string;
  /** Ville/jalon majeur que marque cette station (Edo, Kyōto…) : mise en avant comme repère
      sur la route. Optionnel — seules quelques stations clés en portent un. */
  city?: string;
}

export const TOKAIDO: TokaidoStation[] = [
  { index: 0, kanji: "日本橋", romaji: "Nihonbashi", city: "Edo", note: "Le « pont du Japon », à Edo : point zéro de toutes les routes du pays. Ton voyage commence ici." },
  { index: 1, kanji: "品川", romaji: "Shinagawa", note: "Première étape à la sortie d'Edo, au bord de la baie." },
  { index: 2, kanji: "川崎", romaji: "Kawasaki", note: "On y traversait la rivière Tama en bac." },
  { index: 3, kanji: "神奈川", romaji: "Kanagawa", note: "Village de pêcheurs qui donnera son nom à la préfecture." },
  { index: 4, kanji: "保土ヶ谷", romaji: "Hodogaya" },
  { index: 5, kanji: "戸塚", romaji: "Totsuka", note: "Fin typique de la première journée de marche depuis Edo." },
  { index: 6, kanji: "藤沢", romaji: "Fujisawa" },
  { index: 7, kanji: "平塚", romaji: "Hiratsuka" },
  { index: 8, kanji: "大磯", romaji: "Ōiso" },
  { index: 9, kanji: "小田原", romaji: "Odawara", note: "Ville-château au pied des monts Hakone." },
  { index: 10, kanji: "箱根", romaji: "Hakone", note: "Le col le plus redouté de la route — et son poste de contrôle." },
  { index: 11, kanji: "三島", romaji: "Mishima", note: "Au pied du mont Fuji, célèbre pour son sanctuaire." },
  { index: 12, kanji: "沼津", romaji: "Numazu" },
  { index: 13, kanji: "原", romaji: "Hara", note: "L'estampe d'Hiroshige y montre le Fuji plus grand que le cadre." },
  { index: 14, kanji: "吉原", romaji: "Yoshiwara" },
  { index: 15, kanji: "蒲原", romaji: "Kanbara", note: "« Neige du soir à Kanbara », l'une des plus belles estampes de la série." },
  { index: 16, kanji: "由比", romaji: "Yui" },
  { index: 17, kanji: "興津", romaji: "Okitsu" },
  { index: 18, kanji: "江尻", romaji: "Ejiri" },
  { index: 19, kanji: "府中", romaji: "Fuchū", city: "Shizuoka", note: "Aujourd'hui Shizuoka, ville natale du shōgun retiré Ieyasu." },
  { index: 20, kanji: "鞠子", romaji: "Mariko", note: "Réputée pour sa soupe d'igname (tororo-jiru) servie aux voyageurs." },
  { index: 21, kanji: "岡部", romaji: "Okabe" },
  { index: 22, kanji: "藤枝", romaji: "Fujieda" },
  { index: 23, kanji: "島田", romaji: "Shimada", note: "Rive de l'Ōi, rivière sans pont : on attendait parfois des jours la décrue." },
  { index: 24, kanji: "金谷", romaji: "Kanaya", note: "L'autre rive de l'Ōi — la traversée se faisait à dos de porteur." },
  { index: 25, kanji: "日坂", romaji: "Nissaka" },
  { index: 26, kanji: "掛川", romaji: "Kakegawa" },
  { index: 27, kanji: "袋井", romaji: "Fukuroi", note: "Exactement à mi-chemin : 27ᵉ étape des 53. La moitié du voyage !" },
  { index: 28, kanji: "見付", romaji: "Mitsuke" },
  { index: 29, kanji: "浜松", romaji: "Hamamatsu", note: "La plus grande ville-étape entre Edo et Kyōto." },
  { index: 30, kanji: "舞坂", romaji: "Maisaka", note: "Embarcadère du lac Hamana : on continuait en bateau." },
  { index: 31, kanji: "新居", romaji: "Arai", note: "Poste de contrôle strict à la sortie du bac." },
  { index: 32, kanji: "白須賀", romaji: "Shirasuka" },
  { index: 33, kanji: "二川", romaji: "Futagawa" },
  { index: 34, kanji: "吉田", romaji: "Yoshida", note: "Aujourd'hui Toyohashi, connue pour son château au bord de la Toyo." },
  { index: 35, kanji: "御油", romaji: "Goyu", note: "Célèbre pour ses rabatteuses d'auberge, croquées avec humour par Hiroshige." },
  { index: 36, kanji: "赤坂", romaji: "Akasaka", note: "À 1,7 km de Goyu — l'intervalle le plus court de la route." },
  { index: 37, kanji: "藤川", romaji: "Fujikawa" },
  { index: 38, kanji: "岡崎", romaji: "Okazaki", note: "Ville natale de Tokugawa Ieyasu, et son grand pont de bois." },
  { index: 39, kanji: "池鯉鮒", romaji: "Chiryū", note: "Son nom s'écrivait « étang aux carpes » — marché aux chevaux réputé." },
  { index: 40, kanji: "鳴海", romaji: "Narumi", note: "Réputée pour ses tissus shibori (teinture à réserves nouées)." },
  { index: 41, kanji: "宮", romaji: "Miya", city: "Nagoya", note: "Devant le grand sanctuaire d'Atsuta ; de là, sept lieues de mer jusqu'à Kuwana." },
  { index: 42, kanji: "桑名", romaji: "Kuwana", note: "On y arrivait par bateau — la seule traversée maritime de la route." },
  { index: 43, kanji: "四日市", romaji: "Yokkaichi" },
  { index: 44, kanji: "石薬師", romaji: "Ishiyakushi" },
  { index: 45, kanji: "庄野", romaji: "Shōno", note: "« Averse à Shōno » : la pluie oblique la plus célèbre de l'estampe japonaise." },
  { index: 46, kanji: "亀山", romaji: "Kameyama" },
  { index: 47, kanji: "関", romaji: "Seki", note: "Son nom veut dire « barrière » : ancien poste frontière." },
  { index: 48, kanji: "坂下", romaji: "Sakanoshita", note: "Au pied du col de Suzuka, dernier grand obstacle." },
  { index: 49, kanji: "土山", romaji: "Tsuchiyama", note: "« Pluie de printemps à Tsuchiyama » — le col se passe sous l'averse." },
  { index: 50, kanji: "水口", romaji: "Minakuchi" },
  { index: 51, kanji: "石部", romaji: "Ishibe" },
  { index: 52, kanji: "草津", romaji: "Kusatsu", note: "Jonction avec la route du Nakasendō — la foule des deux routes s'y mêle." },
  { index: 53, kanji: "大津", romaji: "Ōtsu", note: "Dernière étape, au bord du lac Biwa. Kyōto est en vue." },
  { index: 54, kanji: "三条大橋", romaji: "Sanjō Ōhashi", city: "Kyōto", note: "Le grand pont de Sanjō, à Kyōto : terme du Tōkaidō. Tu as fait la route entière." },
];
