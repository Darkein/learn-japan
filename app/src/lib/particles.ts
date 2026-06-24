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
};

/** Connecteur particulier : la forme て / で (lien). */
export const TE_FORMS: Record<string, string> = {
  て: "[lien/te]",
  で: "[lien/te]",
};
