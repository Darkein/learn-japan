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
export interface KanjiItem {
  ja: string;
  fr: string;
}

export type GenKind = "story" | "lesson-intro" | "lesson-story" | "story-translation";

/** Requête de génération : UNIQUEMENT des paramètres structurés (aucun prompt brut). */
export interface GenerateRequest {
  kind?: GenKind;
  level?: number;
  // kind: "story" (génération libre du lecteur) — champs simples.
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  // kind: "lesson-intro" | "lesson-story" — matière d'une leçon.
  title?: string;
  vocab?: VocabItem[];
  kanjiGloss?: KanjiItem[];
  knownKanji?: string[];
  // kind: "story-translation" — phrases JP déjà découpées.
  sentences?: string[];
}

// ---------- Bornes & nettoyage ----------------------------------------------
// Plafonds larges pour l'usage légitime, mais qui empêchent un prompt arbitrairement
// long ou un détournement par injection dans un champ de texte libre.
const LIMITS = {
  theme: 120,
  grammarItem: 60,
  grammarList: 24,
  kanjiToken: 12,
  kanjiList: 64,
  title: 120,
  vocabList: 80,
  vocabField: 80,
  knownKanji: 600,
  sentence: 600,
  sentenceList: 200,
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

function cleanKanjiGloss(value: unknown): KanjiItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, LIMITS.vocabList)
    .map((v) => {
      const it = (v ?? {}) as Record<string, unknown>;
      return { ja: clean(it.ja, LIMITS.vocabField), fr: clean(it.fr, LIMITS.vocabField) };
    })
    .filter((k) => k.ja || k.fr);
}

// ---------- Gabarits ---------------------------------------------------------

function fmtVocab(v: VocabItem): string {
  const reading = v.yomi && v.yomi !== v.ja ? ` (${v.yomi})` : "";
  return `${v.ja}${reading} = ${v.fr}`;
}
function fmtKanji(k: KanjiItem): string {
  return `${k.ja} = ${k.fr}`;
}

/** Génération libre du lecteur : thème / kanji / grammaire / niveau → court texte JP. */
function buildStoryPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const theme = clean(r.theme, LIMITS.theme);
  const kanji = cleanList(r.kanji, LIMITS.kanjiList, LIMITS.kanjiToken);
  const grammar = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const parts = [
    "Écris un petit texte en japonais (court récit, brève ou dialogue) adapté à un apprenant.",
    `Niveau JLPT visé : N${level}.`,
    theme ? `Thème : ${theme}.` : "",
    kanji.length ? `Mets en avant ces kanji : ${kanji.join(" ")}.` : "",
    grammar.length ? `Illustre ces points de grammaire : ${grammar.join(", ")}.` : "",
    "Vise environ 150 à 300 caractères japonais, en 2 à 4 courts paragraphes.",
    "Réponds uniquement avec le texte japonais (pas de furigana, pas de traduction).",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Leçon de grammaire FR développée. C'est le corps pédagogique du cours : une vraie
 * leçon qui enseigne et démontre (intuition, exemples travaillés, nuances de registre,
 * pièges), et non un simple cadrage de quelques phrases. Le détail structuré (lectures
 * des kanji, règles brèves, liste de vocab) reste rendu à part par l'UI depuis
 * l'inventaire : vocabulaire et kanji ne sont fournis ici que comme matière à exemples —
 * ils ne doivent être ni redressés en liste ni expliqués mot à mot.
 */
export function buildLessonIntroPrompt(r: GenerateRequest): string {
  const level = cleanLevel(r.level);
  const title = clean(r.title, LIMITS.title) || "Leçon";
  const vocab = cleanVocab(r.vocab);
  const kanji = cleanKanjiGloss(r.kanjiGloss);
  const grammarList = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);

  const grammar = grammarList.length
    ? `Point(s) de grammaire à enseigner : ${grammarList.join(", ")}.`
    : "Cette leçon n'introduit pas de nouveau point de grammaire ; développe une explication claire et illustrée de son thème.";
  const exampleMaterial = [
    vocab.length ? `Vocabulaire disponible pour bâtir des exemples : ${vocab.map(fmtVocab).join(", ")}.` : "",
    kanji.length ? `Kanji disponibles pour bâtir des exemples : ${kanji.map(fmtKanji).join(", ")}.` : "",
  ].filter(Boolean);

  return [
    `Rédige une véritable leçon de grammaire japonaise (niveau JLPT N${level}) intitulée « ${title} », en FRANÇAIS et au format Markdown. Une vraie leçon qui enseigne et démontre — pas une simple introduction ni un résumé.`,
    grammar,
    ...exampleMaterial,
    "",
    "Enseigne UNIQUEMENT la grammaire ci-dessus, mais en profondeur : l'intuition de départ, comment et quand l'employer, les nuances de registre (poli / neutre, oral / écrit) et l'erreur fréquente du francophone débutant. Construis l'explication progressivement, du cas le plus simple vers les subtilités.",
    "Démontre chaque point avec PLUSIEURS exemples concrets en japonais. Présente chaque exemple sur trois lignes consécutives : la phrase japonaise, puis sa lecture en romaji, puis sa traduction française ; isole chaque exemple par une ligne vide. Ajoute au besoin un contre-exemple (tournure fautive) en expliquant pourquoi elle est fausse.",
    "Tu peux puiser dans le vocabulaire et les kanji fournis pour tes exemples, mais NE dresse PAS la liste du vocabulaire et NE l'explique PAS mot à mot (il est déjà affiché à côté) : sers-t'en seulement comme matière à phrases.",
    "Structure avec des sous-titres Markdown « ## » dès qu'il y a plusieurs idées, des paragraphes courts, et **gras** pour les mots japonais clés. Pas de tableau. Vise une leçon riche mais lisible (environ 4 à 8 paragraphes, exemples compris). Réponds uniquement avec cette leçon en français.",
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
  const kanji = cleanKanjiGloss(r.kanjiGloss);
  const grammarList = cleanList(r.grammar, LIMITS.grammarList, LIMITS.grammarItem);
  const known = cleanList(r.knownKanji, LIMITS.kanjiList, LIMITS.kanjiToken).join("").slice(0, LIMITS.knownKanji);
  const len = storyLength(level);

  const objectives = [
    vocab.length ? `Vocabulaire : ${vocab.map(fmtVocab).join(", ")}.` : "",
    kanji.length ? `Kanji : ${kanji.map(fmtKanji).join(", ")}.` : "",
    grammarList.length ? `Grammaire : ${grammarList.join(", ")}.` : "",
  ];

  return [
    `Écris un texte en japonais pour une leçon de niveau JLPT N${level} intitulée « ${title} ».`,
    "Format libre — court récit, brève (news), dialogue ou scène du quotidien — du moment que c'est cohérent, naturel et formateur.",
    "Il doit mettre en scène ces éléments cibles :",
    ...objectives,
    known.length
      ? `Privilégie au maximum le lexique et les kanji déjà connus de l'apprenant : ${known}. Tu peux introduire un peu de vocabulaire nouveau si c'est nécessaire au naturel du texte, mais reste simple et préfère le déjà-vu (kana au besoin).`
      : "Privilégie un vocabulaire très simple et déjà vu ; un peu de nouveauté reste permise si nécessaire.",
    "",
    `Longueur : un article d'environ ${len.min} à ${len.max} caractères japonais (au minimum ${len.min}), structuré en au moins 2 à 3 paragraphes (sépare les paragraphes par une ligne vide ; ajoute-en si l'histoire le demande).`,
    "Réponds uniquement avec le texte japonais : pas de furigana, pas de romaji, pas de traduction, pas de titre.",
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
 * Point d'entrée : à partir d'une requête structurée, compose le prompt correspondant.
 * Lève si `kind` est inconnu → le Worker répond 400 (aucune génération « passe-partout »).
 */
export function composePrompt(req: GenerateRequest): string {
  switch (req.kind) {
    case "lesson-intro":
      return buildLessonIntroPrompt(req);
    case "lesson-story":
      return buildLessonStoryPrompt(req);
    case "story-translation":
      return buildStoryTranslationPrompt(req);
    case "story":
    case undefined:
      return buildStoryPrompt(req);
    default:
      throw new Error(`kind inconnu : ${String(req.kind)}`);
  }
}
