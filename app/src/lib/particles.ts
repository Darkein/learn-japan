// Table de gloss FIXE des morphèmes grammaticaux (particules, auxiliaires, copule).
// Déterministe et en français : c'est de la grammaire → il y a une bonne réponse, pas de LLM.
// Clé = surface_form (forme telle qu'écrite). `basic_form` sert de repli pour les auxiliaires.

/** Gloss français des particules (助詞). */
export const PARTICLE_GLOSS: Record<string, string> = {
  は: "[thème]",
  が: "[sujet]",
  を: "[objet]",
  に: "à/dans",
  へ: "vers",
  で: "à/par",
  と: "et/avec",
  も: "aussi",
  の: "de/[lien]",
  や: "et(liste)",
  か: "[question]",
  ね: "[accord]",
  よ: "[emphase]",
  な: "[nuance]",
  わ: "[nuance]",
  ぞ: "[emphase]",
  さ: "[nuance]",
  から: "de/car",
  まで: "jusqu'à",
  より: "que/depuis",
  ので: "comme/car",
  のに: "alors que",
  けど: "mais",
  けれど: "mais",
  し: "et(en plus)",
  ば: "si",
  たり: "et autres",
  など: "etc.",
  だけ: "seulement",
  しか: "rien que",
  ばかり: "ne...que",
  くらい: "environ",
  ぐらい: "environ",
  ほど: "au point de",
  こそ: "justement",
  って: "[citation/thème]",
  かも: "peut-être",
  ながら: "tout en",
  つつ: "tout en",
  さえ: "même",
  ずつ: "chacun",
  だり: "et autres",
  にとって: "pour",
  について: "au sujet de",
  によって: "par/selon",
  として: "en tant que",
  に対して: "envers",
  という: "appelé/dit",
};

/** Gloss français des auxiliaires et de la copule (助動詞). */
export const AUX_GLOSS: Record<string, string> = {
  です: "c'est(poli)",
  だ: "c'est",
  でした: "c'était(poli)",
  だっ: "c'est(passé)",
  ます: "[poli]",
  ませ: "[poli]",
  ました: "[poli-passé]",
  ません: "[poli-négatif]",
  た: "[passé]",
  だろう: "sans doute",
  でしょう: "sans doute(poli)",
  ない: "ne-pas",
  ぬ: "ne-pas",
  なかっ: "ne-pas(passé)",
  ず: "sans",
  たい: "vouloir",
  たかっ: "vouloir(passé)",
  そう: "il-paraît/semble",
  らしい: "il-paraît",
  よう: "comme/semble",
  みたい: "comme",
  れる: "[passif/potentiel]",
  られる: "[passif/potentiel]",
  せる: "[causatif]",
  させる: "[causatif]",
  う: "[volitif]",
  まい: "ne...pas(volonté)",
  ん: "ne-pas",
  ましょ: "[invitation]",
  でしょ: "sans doute(poli)",
  だろ: "sans doute",
  べき: "devoir",
  べし: "devoir",
  なら: "si(c'est)",
  たら: "si/quand",
  だら: "si/quand",
  な: "[forme -na]",
};

/** Gloss français de quelques verbes/auxiliaires de support fréquents (par basic_form). */
export const AUX_VERB_GLOSS: Record<string, string> = {
  いる: "[en train de]",
  ある: "il-y-a",
  くる: "venir(devenir)",
  いく: "aller(évoluer)",
  しまう: "[achèvement/regret]",
  おく: "[par anticipation]",
  みる: "[essayer]",
  くれる: "[donner-à-moi]",
  あげる: "[donner]",
  もらう: "[recevoir]",
  くださる: "[s'il-te-plaît]",
  なさる: "[ordre poli]",
  すぎる: "[trop]",
  いける: "[permis]",
};

/**
 * Particules dont la catégorie IPADIC (`pos_detail_1/pos_detail_2`) départage les emplois que
 * la table ci-dessus fond en un seul. (と se départage sur son contexte : lib/toRole.ts.)
 */
export const PARTICLE_ROLE_GLOSS: Record<string, string> = {
  // 静かに : に fait de l'adjectif -な un adverbe, il ne situe rien.
  "に|副詞化": "[adverbe]",
};

/** Connecteur particulier : la forme て / で (lien). */
export const TE_FORMS: Record<string, string> = {
  て: "[lien/te]",
  で: "[lien/te]",
};
