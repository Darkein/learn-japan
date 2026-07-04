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

  const grammar = grammarList.length
    ? `Point(s) de grammaire à enseigner : ${grammarList.join(", ")}.`
    : "Cette leçon n'introduit pas de nouveau point de grammaire ; développe une explication claire et illustrée de son thème.";
  const exampleMaterial = [
    vocab.length ? `Vocabulaire disponible pour bâtir des exemples : ${vocab.map(fmtVocab).join(", ")}.` : "",
  ].filter(Boolean);

  return [
    `Rédige une véritable leçon de grammaire japonaise (niveau JLPT N${level}) intitulée « ${title} », en FRANÇAIS et au format Markdown. Une vraie leçon qui enseigne et démontre — pas une simple introduction ni un résumé. Cette leçon fait parti d'un ensemble de leçons, pas besoin de phrase de bienvenue.`,
    grammar,
    ...exampleMaterial,
    "",
    "Enseigne UNIQUEMENT la grammaire ci-dessus, mais en profondeur : l'intuition de départ, comment et quand l'employer, les nuances de registre (poli / neutre, oral / écrit) et l'erreur fréquente du francophone débutant. Construis l'explication progressivement, du cas le plus simple vers les subtilités.",
    "Démontre chaque point avec PLUSIEURS exemples concrets en japonais. Encadre chaque exemple dans un bloc :::example … ::: : une ligne par phrase japonaise, puis sa traduction française sur la ligne suivante préfixée par « > ». Plusieurs paires JP/traduction sont autorisées dans un même bloc. Pas de romaji (l'application ajoute les furigana automatiquement).",
    "Pour une tournure fautive, utilise un bloc :::pitfall avec l'explication de l'erreur. Pour une note importante, utilise :::info ; pour une mise en garde, :::warning. Termine la leçon par un bloc :::summary listant les 2 à 4 points clés à retenir.",
    "Tu peux puiser dans le vocabulaire fourni pour tes exemples, mais NE dresse PAS la liste du vocabulaire et NE l'explique PAS mot à mot (il est déjà affiché à côté) : sers-t'en seulement comme matière à phrases.",
    "Structure avec des titres Markdown « # » dès qu'il y a plusieurs idées (un seul niveau, et pas de titre pour la leçon), des paragraphes courts, des listes à puces ou numérotées si pertinent. Tu peux utiliser un tableau Markdown pour présenter des formes de conjugaison. Utilise **gras** et *italique* pour mettre en valeur les termes importants en français. Vise une leçon riche mais lisible. Réponds uniquement avec cette leçon en français.",
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
      ? "Tu peux, avec PARCIMONIE, réemployer quelques éléments déjà vus pour réviser (secondaires — le cœur du texte reste les cibles ci-dessus) :"
      : "",
    reviewVocab.length ? `Vocabulaire de révision (optionnel) : ${reviewVocab.map(fmtVocab).join(", ")}.` : "",
    reviewGrammarList.length ? `Grammaire de révision (optionnelle) : ${reviewGrammarList.join(", ")}.` : "",
  ];

  return [
    `Écris un texte en japonais pour une leçon de niveau JLPT N${level} intitulée « ${title} ».`,
    "Format libre — court récit, brève (news), dialogue ou scène du quotidien — du moment que c'est cohérent, naturel et formateur.",
    "Il doit mettre en scène ces éléments cibles :",
    ...objectives,
    ...review,
    "Privilégie un vocabulaire très simple et déjà vu ; un peu de nouveauté reste permise si nécessaire.",
    "",
    `Longueur : un article d'environ ${len.min} à ${len.max} caractères japonais (au minimum ${len.min}), structuré en au moins 2 à 3 paragraphes (sépare les paragraphes par une ligne vide ; ajoute-en si l'histoire le demande).`,
    variant > 1
      ? `Variante ${variant} : propose une histoire DIFFÉRENTE des variantes précédentes pour cette leçon (autre situation, autres personnages, autre angle narratif), tout en respectant les mêmes cibles grammaticales et de vocabulaire.`
      : "",
    avoidTitles.length
      ? `Évite de reprendre le thème ou la situation des histoires déjà écrites pour cette leçon : ${avoidTitles.join(" ; ")}. Choisis un cadre, des personnages et une situation nettement différents.`
      : "",
    "Commence ta réponse par une ligne de titre au format exactement : TITRE: [titre japonais court] | [titre français court]",
    "Puis donne le texte japonais uniquement : pas de furigana, pas de romaji, pas de traduction.",
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
