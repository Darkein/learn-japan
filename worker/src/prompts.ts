// Composition des prompts CÔTÉ WORKER. Le client n'envoie plus jamais d'instruction
// libre : il poste seulement des paramètres structurés et bornés (kind + champs), et
// le Worker assemble le prompt depuis des gabarits fixes, eux-mêmes ancrés sur
// « écris/explique en japonais ». Impossible donc de détourner l'endpoint vers du
// hors-sujet (poème en anglais, code, etc.) ou de gonfler le prompt à volonté.
//
// Toutes les entrées passent par sanitize* : longueurs plafonnées, caractères de
// contrôle/sauts de ligne retirés, listes tronquées. C'est la « validation entrée ».

export interface VocabItem {
  ja: string;
  yomi?: string;
  fr: string;
}

export type GenKind =
  | "story"
  | "lesson"
  | "lesson-story"
  | "story-translation"
  | "comprehension-qcm"
  | "vocab-examples";

/** Requête de génération : UNIQUEMENT des paramètres structurés (aucun prompt brut). */
export interface GenerateRequest {
  kind?: GenKind;
  level?: number;
  // kind: "story" (génération libre du lecteur) — champs simples.
  theme?: string;
  grammar?: string[];
  // kind: "lesson" | "lesson-story" — matière d'une leçon.
  title?: string;
  vocab?: VocabItem[];
  // kind: "lesson" — position dans le parcours (1 = première leçon) : module la longueur
  // du cours généré (les premières leçons restent courtes et rassurantes).
  lessonOrder?: number;
  // Révision du contenu de la leçon (curriculum.json) : change la clé de cache R2 quand
  // les objectifs d'une leçon évoluent, pour ne jamais servir un cours périmé.
  rev?: number;
  // kind: "lesson-story" — révision (leçons précédentes, pondérée plus bas) et anti-répétition.
  reviewVocab?: VocabItem[];
  reviewGrammar?: string[];
  avoidTitles?: string[];
  // kind: "story-translation" — phrases JP déjà découpées.
  sentences?: string[];
  // kind: "vocab-examples" — lexique déjà connu à privilégier dans les phrases.
  allowedVocab?: string[];
  // Métadonnées de clé R2 structurée (lesson / lesson-story uniquement).
  lessonId?: string;
  variant?: number;
}

// ---------- Bornes & nettoyage ----------------------------------------------
// Plafonds larges pour l'usage légitime, mais qui empêchent un prompt arbitrairement
// long ou un détournement par injection dans un champ de texte libre.
const LIMITS = {
  theme: 120,
  grammarItem: 120,
  grammarList: 24,
  title: 120,
  vocabList: 80,
  vocabField: 80,
  reviewVocabList: 20,
  reviewGrammarList: 8,
  avoidTitleItem: 120,
  avoidTitleList: 8,
  sentence: 600,
  sentenceList: 200,
  exampleVocabList: 20,
  allowedVocabList: 400,
  allowedVocabItem: 40,
  // Illustration : le texte d'histoire déjà généré sert de contexte de scène. Borne large
  // (une histoire N1 monte à ~750 caractères JP) mais fermée.
  illustrationText: 1200,
} as const;

/** Retire les caractères de contrôle (dont sauts de ligne) et plafonne la longueur. */
function clean(value: unknown, max: number): string {
  return String(value ?? "")
    // Caractères de contrôle (sauts de ligne inclus) → espace : un champ de texte
    // libre ne peut plus injecter de nouvelle « instruction » multiligne.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Nettoie une liste de chaînes : tronque le nombre d'éléments puis chaque élément. */
function cleanList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((v) => clean(v, maxLen))
    .filter(Boolean);
}

/** Niveau JLPT borné à 1..5 (défaut 5 = N5, le plus simple). */
function cleanLevel(level: unknown): number {
  const n = Math.round(Number(level));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 5;
}

/**
 * Assainit un identifiant de leçon (slugifié) pour usage dans une clé R2.
 * N'autorise que `[a-z0-9-]`, plafonne à 64 caractères. Protège contre les
 * path-traversal (`../`), injections et majuscules non normalisées.
 */
export function cleanSlug(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);
}

/** Numéro de variante d'histoire, borné à 1..50 (défaut 1). */
export function cleanVariant(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 1;
}

/** Position de la leçon dans le parcours, bornée à 1..999 (0 = inconnue). */
function cleanOrder(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 999 ? n : 0;
}

/** Révision du contenu d'une leçon, bornée à 1..99 (défaut 1). */
export function cleanRev(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 1;
}

function cleanVocab(value: unknown): VocabItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, LIMITS.vocabList)
    .map((v) => {
      const it = (v ?? {}) as Record<string, unknown>;
      return {
        ja: clean(it.ja, LIMITS.vocabField),
        yomi: it.yomi != null ? clean(it.yomi, LIMITS.vocabField) : undefined,
        fr: clean(it.fr, LIMITS.vocabField),
      };
    })
    .filter((v) => v.ja || v.fr);
}

// ---------- Gabarits ---------------------------------------------------------

function fmtVocab(v: VocabItem): string {
  const reading = v.yomi && v.yomi !== v.ja ? ` (${v.yomi})` : "";
  return `${v.ja}${reading} = ${v.fr}`;
}

/** Génération libre du lecteur : thème / grammaire / niveau → court texte JP. */
function buildStoryPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const theme = clean(r.theme, LIMITS.theme);
  const grammar = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const parts = [
    "Écris un petit texte en japonais (court récit, brève ou dialogue) adapté à un apprenant.",
    `Niveau JLPT visé : N${level}.`,
    theme ? `Thème : ${theme}.` : "",
    grammar.length ? `Illustre ces points de grammaire : ${grammar.join(", ")}.` : "",
    "Vise environ 150 à 300 caractères japonais, en 2 à 4 courts paragraphes.",
    "Écris chaque mot dans sa graphie japonaise standard, avec les kanji usuels — n'écris pas en kana un mot qui s'écrit normalement en kanji (l'application ajoute les furigana automatiquement).",
    "Réponds uniquement avec le texte japonais (pas de furigana, pas de traduction).",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Leçon de grammaire FR développée. C'est le corps pédagogique du cours : une vraie
 * leçon qui enseigne et démontre (intuition, exemples travaillés, nuances de registre,
 * pièges), et non un simple cadrage de quelques phrases. Le détail structuré (règles
 * brèves, liste de vocab) reste rendu à part par l'UI depuis l'inventaire : le vocabulaire
 * n'est fourni ici que comme matière à exemples — il ne doit être ni redressé en liste
 * ni expliqué mot à mot.
 */
export function buildLessonPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const title = clean(r.title, LIMITS.title) || "Leçon";
  const vocab = cleanVocab(r.vocab);
  const grammarList = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const order = cleanOrder(r.lessonOrder);
  // Les toutes premières leçons DU PARCOURS s'adressent à un débutant absolu : courtes et
  // rassurantes. `order` redémarre à 1 à chaque niveau — seul le début de N5 est concerné.
  const intro = level === 5 && order >= 1 && order <= 5;

  const grammar = grammarList.length
    ? `Point(s) de grammaire à enseigner : ${grammarList.join(", ")}.`
    : "Cette leçon n'introduit pas de nouveau point de grammaire : c'est une leçon de vocabulaire thématique. Développe une explication courte et vivante de son thème (comment ces mots s'emploient, ce qui surprend un francophone), sans lister les mots un à un.";
  const exampleMaterial = [
    vocab.length ? `Vocabulaire disponible pour bâtir des exemples : ${vocab.map(fmtVocab).join(", ")}.` : "",
  ].filter(Boolean);

  // Longueur cible : très courte en tout début de parcours, puis proportionnelle au
  // nombre de points enseignés — jamais « riche » sans borne (mur de texte).
  const sizing = intro
    ? "LONGUEUR : c'est l'une des toutes premières leçons du parcours, lue par un débutant absolu. Vise environ 250 à 400 mots, une idée à la fois, phrases courtes, 2 ou 3 blocs :::example maximum. Densité maximale : coupe le remplissage, garde l'information."
    : grammarList.length <= 1
      ? "LONGUEUR : vise environ 350 à 500 mots — une leçon focalisée et digeste, chaque paragraphe utile."
      : grammarList.length === 2
        ? "LONGUEUR : vise environ 500 à 700 mots — développée mais aérée."
        : "LONGUEUR : vise environ 700 à 900 mots — structurée en sections courtes, chaque section utile.";

  // Consignes courtes et impératives, une par ligne : mieux suivies par un modèle moyen
  // qu'une phrase composée. Le mode intro reste court mais exige de la substance — court
  // ne veut pas dire creux (travers observé : la règle répétée 5 fois, rien enseigné).
  const teaching = intro
    ? [
        "Enseigne UNIQUEMENT la grammaire ci-dessus, simplement mais avec de la substance.",
        "Donne la règle une seule fois, avec un exemple immédiat.",
        "Montre le cas d'emploi le plus courant.",
        "Signale UNE erreur fréquente du francophone débutant (bloc :::pitfall).",
        "Ajoute 1 ou 2 particularités concrètes : une variante et sa nuance, un fait d'usage réel, un « le saviez-vous ».",
        "Court veut dire SANS remplissage, pas sans contenu : chaque phrase apprend quelque chose de nouveau.",
        "Garde les nuances avancées et les cas rares pour les leçons suivantes.",
      ]
    : [
        "Enseigne UNIQUEMENT la grammaire ci-dessus, en profondeur.",
        "Donne la règle une seule fois, au début, avec un exemple immédiat.",
        "Ensuite élargis : chaque section suivante répond à une QUESTION DIFFÉRENTE de l'apprenant (avec quoi ? exceptions ? nuances ? registre poli/neutre, oral/écrit ?).",
        "Signale l'erreur typique du francophone dans un bloc :::pitfall.",
        "Progresse du cas simple vers les subtilités.",
      ];

  return [
    "Tu es un professeur de japonais expérimenté qui enseigne à des francophones : tu connais leurs difficultés spécifiques et tu anticipes leurs questions.",
    `Rédige une leçon de japonais (niveau JLPT N${level}) intitulée « ${title} », en FRANÇAIS et au format Markdown.`,
    "Objectif : après lecture, l'apprenant sait des choses PRÉCISES et NOUVELLES, pas seulement la règle générale.",
    "Cette leçon fait partie d'un parcours : pas de phrase de bienvenue, pas d'introduction générale.",
    "Commence directement par la règle et un premier exemple. N'écris AUCUNE phrase qui reformule le titre.",
    grammar,
    ...exampleMaterial,
    ...teaching,
    "CONTENU — couvre chacun de ces aspects s'il s'applique au point enseigné (ordre de priorité) :",
    "1. PORTÉE : avec quels mots ou situations la structure s'emploie, et avec lesquels elle ne s'emploie pas.",
    "2. EXCEPTIONS : les cas irréguliers ou surprenants utiles à ce niveau.",
    "3. VARIANTES : les formes proches et leur nuance (exemple type : 勉強をする vs 勉強する).",
    "4. USAGE RÉEL : dis si la tournure est très courante, plutôt formelle, plutôt orale ou rare.",
    "5. FRANÇAIS : une comparaison rapide avec le français quand elle aide.",
    "Ces libellés (PORTÉE, EXCEPTIONS…) sont des consignes pour toi : ne les recopie pas dans la leçon — formule des titres naturels.",
    "Une note culturelle courte en :::info est bienvenue si elle éclaire vraiment l'usage.",
    "EXACTITUDE : appuie-toi uniquement sur des faits de langue standards et bien établis. En cas de doute sur une exception ou une nuance, omets-la. Aucune statistique chiffrée, aucune étymologie douteuse.",
    "Démontre chaque point avec des exemples concrets en japonais. Encadre chaque exemple dans un bloc :::example … ::: : une ligne par phrase japonaise, puis sa traduction française sur la ligne suivante préfixée par « > ». Plusieurs paires JP/traduction sont autorisées dans un même bloc. Pas de romaji (l'application ajoute les furigana automatiquement).",
    "ORTHOGRAPHE : n'insère JAMAIS d'espace à l'intérieur d'une phrase japonaise — écris « 私は日本語を勉強する。 », pas « 私 は 日本語 を 勉強する。 ». Aucune lecture entre parenthèses (jamais « 私（わたし） » — l'application affiche les furigana toute seule). Chaque phrase d'exemple doit être grammaticalement irréprochable — ne présente jamais une tournure douteuse comme correcte.",
    "Pour une tournure fautive, utilise un bloc :::pitfall avec l'explication de l'erreur. Pour une note importante, utilise :::info ; pour une mise en garde, :::warning.",
    "Termine par un bloc :::summary de 2 à 4 puces. Chaque puce porte sur un point DIFFÉRENT vu dans la leçon (règle, portée, exception, nuance, piège). La règle de base occupe au maximum UNE puce.",
    "IMPORTANT — referme TOUJOURS chaque bloc (:::example, :::pitfall, :::info, :::warning, :::summary) par une ligne seule contenant exactement « ::: » (TROIS deux-points, ni deux ni quatre) avant d'écrire quoi que ce soit d'autre (titre, paragraphe ou nouveau bloc). Ne jamais imbriquer un bloc dans un autre.",
    "Tu peux puiser dans le vocabulaire fourni pour tes exemples, mais NE dresse PAS la liste du vocabulaire et NE l'explique PAS mot à mot (il est déjà affiché à côté) : sers-t'en seulement comme matière à phrases.",
    "N'emploie dans tes exemples QUE la grammaire enseignée ici ou plus élémentaire qu'elle : rien qui ne soit pas encore vu à ce stade du parcours.",
    "ANTI-RÉPÉTITION — règle stricte :",
    "La règle de base est énoncée UNE seule fois dans toute la leçon (résumé exclu).",
    "Chaque phrase apporte une information nouvelle : un fait, une limite, une nuance ou un exemple inédit.",
    "Il est INTERDIT de redire une idée déjà écrite avec d'autres mots.",
    "Si un paragraphe se contente de reformuler, supprime-le.",
    `Structure avec des titres Markdown « # » dès qu'il y a plusieurs idées (un seul niveau, et pas de titre pour la leçon), des paragraphes courts, des listes à puces ou numérotées si pertinent. Tu peux utiliser un tableau Markdown pour présenter des formes de conjugaison. Utilise **gras** et *italique* pour mettre en valeur les termes importants en français. ${sizing} Réponds uniquement avec cette leçon en français.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Longueur cible (caractères JP) d'une histoire, croissante du N5 au N1 avec un
 * plancher minimum garanti. `level` est le numéro JLPT : 5 = N5 … 1 = N1.
 */
function storyLength(level: number): { min: number; max: number } {
  const table: Record<number, { min: number; max: number }> = {
    5: { min: 240, max: 360 },
    4: { min: 300, max: 450 },
    3: { min: 360, max: 540 },
    2: { min: 420, max: 620 },
    1: { min: 500, max: 750 },
  };
  return table[level] ?? table[3];
}

/**
 * Petit texte japonais (mini-article / brève / dialogue) ciblant les objectifs de la
 * leçon, dont la longueur s'adapte au niveau. Privilégie le lexique déjà vu sans
 * l'imposer.
 */
export function buildLessonStoryPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const title = clean(r.title, LIMITS.title) || "Leçon";
  const vocab = cleanVocab(r.vocab);
  const grammarList = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const reviewVocab = cleanVocab(r.reviewVocab).slice(0, LIMITS.reviewVocabList);
  const reviewGrammarList = cleanList(r.reviewGrammar, LIMITS.reviewGrammarList, LIMITS.grammarItem);
  const avoidTitles = cleanList(r.avoidTitles, LIMITS.avoidTitleList, LIMITS.avoidTitleItem);
  const variant = cleanVariant(r.variant);
  const len = storyLength(level);

  const objectives = [
    vocab.length ? `Vocabulaire : ${vocab.map(fmtVocab).join(", ")}.` : "",
    grammarList.length ? `Grammaire : ${grammarList.join(", ")}.` : "",
  ];

  const review = [
    reviewVocab.length || reviewGrammarList.length
      ? "Réemploie LIBREMENT ces éléments déjà appris pour enrichir et varier le récit (le cœur du texte reste les cibles ci-dessus, mais pioche largement dans cette liste — un récit qui n'utilise que les cibles devient pauvre et répétitif) :"
      : "",
    reviewVocab.length ? `Vocabulaire de révision : ${reviewVocab.map(fmtVocab).join(", ")}.` : "",
    reviewGrammarList.length ? `Grammaire de révision : ${reviewGrammarList.join(", ")}.` : "",
  ];

  return [
    `Écris un texte en japonais pour une leçon de niveau JLPT N${level} intitulée « ${title} ».`,
    "Format libre — court récit, brève (news), dialogue ou scène du quotidien — mais raconte une VRAIE petite histoire, pas une suite de phrases interchangeables : une situation, un personnage qui veut ou ressent quelque chose, une progression et une petite chute ou conclusion.",
    "Il doit mettre en scène ces éléments cibles :",
    ...objectives,
    ...review,
    `Au-delà de ces listes, tu peux introduire quelques mots nouveaux de niveau N${level} (ou plus simple) quand le récit y gagne — l'apprenant pourra consulter leur traduction. Reste en revanche strictement dans la grammaire indiquée ci-dessus, ou plus élémentaire qu'elle.`,
    "VARIÉTÉ : ne répète pas le même sujet ni le même schéma d'une phrase à l'autre (évite l'enchaînement « Xがいます。かわいいXです。Xが〜ます。 »). Fais avancer l'action, change de sujet, varie les tournures ; que chaque phrase apporte un élément nouveau.",
    "ORTHOGRAPHE : écris chaque mot dans sa graphie japonaise standard, avec les kanji usuels — n'écris JAMAIS en kana (hiragana) un mot qui s'écrit normalement en kanji. Reprends exactement la graphie donnée pour le vocabulaire ci-dessus, partie avant la parenthèse (ex. « 牛乳 » et non « ぎゅうにゅう », « 今日 » et non « きょう »). L'application ajoute les furigana automatiquement : l'apprenant lira la lecture au-dessus du kanji.",
    "",
    `Longueur : un article d'environ ${len.min} à ${len.max} caractères japonais (au minimum ${len.min}), structuré en au moins 2 à 3 paragraphes (sépare les paragraphes par une ligne vide ; ajoute-en si l'histoire le demande).`,
    variant > 1
      ? `Variante ${variant} : propose une histoire DIFFÉRENTE des variantes précédentes pour cette leçon (autre situation, autres personnages, autre angle narratif), tout en respectant les mêmes cibles grammaticales et de vocabulaire.`
      : "",
    avoidTitles.length
      ? `Évite de reprendre le thème ou la situation des histoires déjà écrites pour cette leçon : ${avoidTitles.join(" ; ")}. Choisis un cadre, des personnages et une situation nettement différents.`
      : "",
    "Commence ta réponse par une ligne de titre au format exactement : TITRE: [titre japonais court] | [titre français court]",
    "Le titre n'apparaît QUE sur cette ligne TITRE : ne le recopie PAS dans l'histoire. Le texte commence directement par la première phrase du récit — pas de titre répété, pas de ligne d'en-tête (« # »), pas de titre en japonais ni en français en haut du corps.",
    "Puis donne le texte japonais uniquement : pas de furigana ni de lecture entre parenthèses, pas de romaji, pas de traduction, aucun mot français dans le corps.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Traduction FR alignée phrase par phrase d'une histoire JP déjà découpée + titre FR. */
export function buildStoryTranslationPrompt(r: GenerateRequest): string {
  const sentences = cleanList(r.sentences, LIMITS.sentenceList, LIMITS.sentence);
  const n = sentences.length;
  const numbered = sentences.map((s, i) => `[${i + 1}] ${s}`).join("\n");
  return [
    `Voici une histoire en japonais découpée en ${n} phrases numérotées.`,
    "Donne d'abord un titre court en français, sur une ligne préfixée par « TITRE: ».",
    `Puis traduis CHAQUE phrase en français naturel, une traduction par ligne, dans l'ordre, préfixée par son numéro (« 1. », « 2. », … jusqu'à « ${n}. »). Exactement ${n} lignes de traduction, aucune fusion, aucune phrase sautée.`,
    "Traduis en français PUR : n'inclus AUCUN caractère japonais (kanji/kana), AUCUNE transcription en romaji et AUCUNE glose entre parenthèses (pas de « le chat (猫) », pas de « (neko) »). Traduis tout, y compris les noms communs. Le titre suit la même règle.",
    "Ne renvoie rien d'autre.",
    "",
    numbered,
  ].join("\n");
}

/**
 * QCM de compréhension d'une histoire JP (déjà découpée en phrases) : 4 questions en
 * FRANÇAIS testant le SENS du récit, chacune taguée du point de grammaire qu'elle
 * vérifie. Le client ne reçoit QUE du texte : il poste les phrases + la liste ordonnée
 * des points de grammaire de la leçon (« nom — règle »), le Worker les numérote G1, G2…
 * Le parsing du QCM reste côté client (parseComprehensionQcm).
 */
export function buildComprehensionQcmPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const sentences = cleanList(r.sentences, LIMITS.sentenceList, LIMITS.sentence);
  const grammar = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const story = sentences.join(" ");
  const grammarBlock = grammar.length
    ? grammar.map((g, i) => `G${i + 1}. ${g}`).join("\n")
    : "(aucun point de grammaire fourni)";

  return [
    `Voici une histoire en japonais (niveau JLPT N${level}) :`,
    story,
    "",
    "Points de grammaire de la leçon (référence pour le tag de chaque question) :",
    grammarBlock,
    "",
    "Rédige un QCM de COMPRÉHENSION en FRANÇAIS pour vérifier que l'apprenant a compris le SENS de cette histoire (qui fait quoi, où, quand, pourquoi) — surtout PAS une simple traduction mot à mot.",
    "Donne exactement 4 questions. Chaque question a 4 propositions de réponse en français, dont une seule correcte.",
    grammar.length
      ? "Tague chaque question avec le point de grammaire qu'elle sollicite le plus, sous la forme [G1], [G2]… selon la liste ci-dessus ; utilise [G0] si la question ne porte sur aucun point précis."
      : "Préfixe chaque question par [G0] (aucun point de grammaire de référence).",
    "",
    "Format STRICT, sans aucune autre ligne : pour chaque question, une ligne « N. [Gk] question », puis ses 4 propositions, une par ligne, préfixées par « + » pour la bonne réponse et « - » pour les trois mauvaises. Exemple :",
    "1. [G2] Pourquoi le chat est-il content ?",
    "+ Parce qu'il a mangé.",
    "- Parce qu'il a dormi.",
    "- Parce qu'il a plu.",
    "- Parce qu'il est parti.",
    "",
    "Questions ET propositions uniquement en français (aucun kanji/kana/romaji). Réponds uniquement avec le QCM.",
  ].join("\n");
}

/**
 * Phrases d'exemple pour un lot de mots de vocabulaire (corpus statique, généré au
 * build par scripts/build-examples.ts). Une phrase très courte par mot, contenant le
 * mot tel quel, en privilégiant un lexique déjà connu de l'apprenant — la conformité
 * est revérifiée côté script (tokenisation kuromoji), le prompt n'est qu'un premier filtre.
 */
export function buildVocabExamplesPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const vocab = cleanVocab(r.vocab).slice(0, LIMITS.exampleVocabList);
  const allowed = cleanList(r.allowedVocab, LIMITS.allowedVocabList, LIMITS.allowedVocabItem);
  const numbered = vocab.map((v, i) => `${i + 1}. ${fmtVocab(v)}`).join("\n");
  return [
    `Voici ${vocab.length} mots de vocabulaire japonais (niveau JLPT N${level}) :`,
    numbered,
    "",
    "Pour CHAQUE mot, écris UNE phrase d'exemple courte en japonais qui l'emploie naturellement, puis sa traduction française.",
    `Contraintes : phrase très simple (grammaire N${level} uniquement), environ 8 à 20 caractères japonais, et le mot cible doit apparaître TEL QUEL dans la phrase (même graphie).`,
    allowed.length
      ? `En dehors du mot cible, n'utilise QUE ce vocabulaire déjà connu de l'apprenant (plus particules, copules et mots grammaticaux) : ${allowed.join("、")}.`
      : "",
    "Format STRICT, une ligne par mot, dans l'ordre, sans aucune autre ligne : « N. phrase japonaise || traduction française ». Pas de furigana, pas de romaji.",
    "Exemple : 1. 猫は水を飲みます。 || Le chat boit de l'eau.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Illustration d'histoire (ukiyo-e) --------------------------------
// L'image est produite CÔTÉ WORKER, juste après le texte d'une histoire (voir index.ts),
// à partir de ce texte. Aucun endpoint image public : la génération est repliée dans
// /generate. Le style est une CONSTANTE figée ici → toutes les images se ressemblent,
// comme signées par un seul et même illustrateur (« même dessinateur »).

/**
 * Style de dessin UNIQUE et immuable de l'illustrateur attitré : estampe japonaise
 * (ukiyo-e). C'est la seule source de vérité du style — ne jamais le paramétrer depuis
 * le client. Toute image d'histoire hérite exactement de cette description.
 */
export const IMAGE_STYLE = [
  "Traditional Japanese ukiyo-e woodblock print in the Edo-period style:",
  "flat matte color fields, a limited harmonious palette (indigo, ochre, vermilion red,",
  "soft green), crisp black ink outlines, no realistic shadows, flat perspective, balanced",
  "composition, subtle textured washi paper grain. Always the same illustrator: keep this",
  "exact style identical from one image to the next.",
].join(" ");

/**
 * Prompt NÉGATIF : cible les artefacts fréquents (branches parasites, architecture déformée,
 * anatomie incorrecte). Utilisé par les modèles qui le supportent (FLUX.2, Qwen, Seedream…) ;
 * ignoré par FLUX.1-schnell. En anglais : meilleure prise en compte par les encodeurs.
 */
export const IMAGE_NEGATIVE = [
  "extra or floating branches",
  "disconnected or overlapping elements",
  "deformed or impossible architecture",
  "warped roof",
  "broken or inconsistent perspective",
  "extra limbs",
  "extra fingers",
  "malformed hands or faces",
  "fused bodies",
  "duplicated subjects",
  "photorealistic shading",
  "3D render",
  "glossy highlights",
  "text, letters, words, numbers, kanji, kana",
  "watermark, signature",
  "blurry",
  "cluttered chaotic composition",
].join(", ");

/**
 * Prompt de DISTILLATION : demande au modèle de texte de résumer l'histoire japonaise en une
 * brève description VISUELLE concrète (anglais), à donner ensuite au modèle d'image. Évite de
 * jeter tout un récit au générateur d'image (source d'hallucinations : branches/archi incohérentes).
 */
export function buildSceneBriefPrompt(storyText: string): string {
  const s = clean(storyText, LIMITS.illustrationText);
  return [
    "Tu es directeur artistique. À partir de cette courte histoire japonaise, écris en ANGLAIS",
    "UNE seule description visuelle concrète (1 à 2 phrases, 40 mots maximum) d'un instant clé à",
    "illustrer : sujet principal, lieu, action, saison ou moment de la journée, ambiance.",
    "Ne décris QUE ce qui est visible — pas de narration, pas de dialogue, pas de texte à l'écran.",
    "Reste fidèle à l'histoire et physiquement plausible (une seule scène cohérente).",
    "",
    `Histoire : ${s}`,
    "",
    "Réponds uniquement par la description, sans préambule ni guillemets.",
  ].join("\n");
}

/**
 * Prompt d'illustration : STYLE figé (ukiyo-e) + une scène (idéalement un brief visuel distillé,
 * sinon le texte de l'histoire en repli). Contraintes fixes : une seule scène cohérente,
 * plausibilité physique/anatomique/architecturale, et AUCUN texte dans l'image.
 */
export function buildStoryIllustrationPrompt(scene: string, titleFr?: string, level?: number): string {
  const s = clean(scene, LIMITS.illustrationText);
  const title = clean(titleFr, LIMITS.title);
  const lvl = cleanLevel(level);
  return [
    IMAGE_STYLE,
    "",
    `Depict a SINGLE coherent scene for a short Japanese learner story (JLPT N${lvl}).`,
    title ? `Title: "${title}".` : "",
    `Scene to illustrate: ${s}`,
    "",
    "Show one clear focal moment (characters, place, action), faithful to the scene.",
    "Everything must be physically plausible and structurally coherent: correct human and",
    "animal anatomy; buildings, roofs and bridges with consistent, believable architecture;",
    "trees with branches attached naturally to the trunk (never floating or stray); a single",
    "uncluttered composition with one clear focal point.",
    "Do not draw any text, letters, words, numbers, kanji, kana or logos — illustration only.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Point d'entrée : à partir d'une requête structurée, compose le prompt correspondant.
 * Lève si `kind` est inconnu → le Worker répond 400 (aucune génération « passe-partout »).
 */
export function composePrompt(req: GenerateRequest): string {
  switch (req.kind) {
    case "lesson":
      return buildLessonPrompt(req);
    case "lesson-story":
      return buildLessonStoryPrompt(req);
    case "story-translation":
      return buildStoryTranslationPrompt(req);
    case "comprehension-qcm":
      return buildComprehensionQcmPrompt(req);
    case "vocab-examples":
      return buildVocabExamplesPrompt(req);
    case "story":
    case undefined:
      return buildStoryPrompt(req);
    default:
      throw new Error(`kind inconnu : ${String(req.kind)}`);
  }
}
