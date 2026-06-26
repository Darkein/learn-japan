// Client de génération : poste une requête ciblée au Worker, qui répond directement.
// Le Worker (et lui seul) appelle Gemini avec la clé secrète → rien à voler côté client.

import { WORKER_URL } from "./config";

export interface GenParams {
  kind?: "story" | "lesson";
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  prompt?: string;
  level?: number;
}

export type GenState = "queued" | "generating" | "ready" | "error" | "unknown";

interface GenerateResponse {
  text?: string;
  error?: string;
}

/**
 * Génère un texte : un seul aller-retour synchrone vers le Worker.
 * `onState` permet d'afficher la progression côté UI.
 */
export async function generateText(
  params: GenParams,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  onState?.("generating");

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "story", ...params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    onState?.("error");
    throw new Error(`Worker injoignable : ${String(e)}`);
  }

  const data = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok || data.error) {
    onState?.("error");
    throw new Error(data.error ?? `generate HTTP ${res.status}`);
  }
  if (!data.text) {
    onState?.("error");
    throw new Error("Réponse vide du Worker");
  }

  onState?.("ready");
  return data.text;
}

// ---------- Génération de leçon : cours et histoire, SÉPARÉS ----------------
// Le cours (pédagogie) et l'histoire (matière à lire) sont deux choses distinctes :
//  - generateLessonIntro → un CADRAGE FR qui complète le cours assemblé depuis l'inventaire ;
//  - generateLessonStory → une HISTOIRE JP, contrainte au lexique déjà vu, sauvée en StoryRecord.

export interface LessonGenInput {
  title: string;
  level: number;
  vocab: { ja: string; yomi?: string; fr: string }[];
  kanji: { ja: string; fr: string }[];
  grammar: string[];
  /** Lexique cumulé déjà connu (leçons précédentes) — contraint l'histoire à du déjà-vu. */
  known?: { kanji: string[] };
}

function fmtVocab(v: { ja: string; yomi?: string; fr: string }): string {
  const reading = v.yomi && v.yomi !== v.ja ? ` (${v.yomi})` : "";
  return `${v.ja}${reading} = ${v.fr}`;
}
function fmtKanji(k: { ja: string; fr: string }): string {
  return `${k.ja} = ${k.fr}`;
}

function objectivesBlock(input: LessonGenInput): string[] {
  return [
    input.vocab.length ? `Vocabulaire : ${input.vocab.map(fmtVocab).join(", ")}.` : "",
    input.kanji.length ? `Kanji : ${input.kanji.map(fmtKanji).join(", ")}.` : "",
    input.grammar.length ? `Grammaire : ${input.grammar.join(", ")}.` : "",
  ];
}

/**
 * Cadrage pédagogique FR d'une leçon. Volontairement COURT et centré sur la seule
 * GRAMMAIRE : le détail structuré (lectures des kanji, règles + exemples, liste de vocab)
 * est déjà rendu par l'UI depuis l'inventaire. Le vocabulaire et les kanji ne sont fournis
 * ici que comme matière à exemples — ils ne doivent être ni listés ni expliqués.
 */
export function buildLessonIntroPrompt(input: LessonGenInput): string {
  const grammar = input.grammar.length
    ? `Points de grammaire à expliquer : ${input.grammar.join(", ")}.`
    : "Cette leçon n'introduit pas de nouveau point de grammaire ; présente brièvement son thème.";
  // Vocab/kanji fournis UNIQUEMENT comme matière à exemples, jamais à lister/expliquer.
  const exampleMaterial = [
    input.vocab.length ? `Vocabulaire disponible pour illustrer : ${input.vocab.map(fmtVocab).join(", ")}.` : "",
    input.kanji.length ? `Kanji disponibles pour illustrer : ${input.kanji.map(fmtKanji).join(", ")}.` : "",
  ].filter(Boolean);

  return [
    `Rédige le cadrage d'une leçon de japonais (niveau JLPT N${input.level}) intitulée « ${input.title} », en FRANÇAIS et au format Markdown.`,
    grammar,
    ...exampleMaterial,
    "",
    "Explique UNIQUEMENT la grammaire ci-dessus : l'intuition, comment l'employer, et un piège fréquent. Tu peux t'appuyer sur le vocabulaire/kanji fournis pour un mini-exemple, mais NE les liste PAS et NE les explique PAS (ils sont déjà affichés à côté).",
    "Sois bref : 2 à 4 phrases courtes (ce cadrage doit rester plus court que les sections affichées en dessous). **gras** autorisé pour les mots japonais clés. Pas de titre, pas de liste. Réponds uniquement avec ce texte FR.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateLessonIntro(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const prompt = buildLessonIntroPrompt(input);
  return (await generateText({ kind: "lesson", prompt, level: input.level }, onState, opts)).trim();
}

/**
 * Longueur cible (caractères JP) d'une histoire, croissante du N5 au N1 avec un
 * plancher minimum garanti. `level` est le numéro JLPT : 5 = N5 … 1 = N1.
 */
function storyLength(level: number): { min: number; max: number } {
  // Planchers relevés pour garantir au moins 2-3 paragraphes consistants (N5 ne doit plus
  // se réduire à 3 phrases). La longueur reste croissante du N5 au N1.
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
 * l'imposer. Retourne le texte JP brut ; l'appelant le sauve en StoryRecord (lessonId).
 */
export function buildLessonStoryPrompt(input: LessonGenInput): string {
  const len = storyLength(input.level);
  return [
    `Écris un texte en japonais pour une leçon de niveau JLPT N${input.level} intitulée « ${input.title} ».`,
    "Format libre — court récit, brève (news), dialogue ou scène du quotidien — du moment que c'est cohérent, naturel et formateur.",
    "Il doit mettre en scène ces éléments cibles :",
    ...objectivesBlock(input),
    input.known?.kanji.length
      ? `Privilégie au maximum le lexique et les kanji déjà connus de l'apprenant : ${input.known.kanji.join("")}. Tu peux introduire un peu de vocabulaire nouveau si c'est nécessaire au naturel du texte, mais reste simple et préfère le déjà-vu (kana au besoin).`
      : "Privilégie un vocabulaire très simple et déjà vu ; un peu de nouveauté reste permise si nécessaire.",
    "",
    `Longueur : un article d'environ ${len.min} à ${len.max} caractères japonais (au minimum ${len.min}), structuré en au moins 2 à 3 paragraphes (sépare les paragraphes par une ligne vide ; ajoute-en si l'histoire le demande).`,
    "Réponds uniquement avec le texte japonais : pas de furigana, pas de romaji, pas de traduction, pas de titre.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateLessonStory(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const prompt = buildLessonStoryPrompt(input);
  return (
    await generateText(
      { kind: "story", prompt, level: input.level },
      onState,
      // Génération plus longue (texte plus volumineux + repli éventuel de modèle).
      { timeoutMs: opts.timeoutMs ?? 120_000 },
    )
  ).trim();
}

// ---------- Traduction d'histoire (mode podcast : alternance JP / FR) --------
// Pour l'écoute bilingue (SPEC §11), il faut une traduction FR alignée PHRASE PAR PHRASE
// sur le découpage JP. On passe les phrases déjà découpées et on exige le même nombre de
// lignes FR → alignement garanti. On obtient aussi un titre FR court (annoncé à l'oral).

export interface StoryTranslation {
  titleFr: string;
  /** Une traduction par phrase JP, dans le même ordre (longueur = jaSentences.length). */
  sentences: string[];
}

/** Extrait le titre et les N traductions du texte renvoyé par le modèle (robuste au bruit). */
export function parseStoryTranslation(raw: string, n: number): StoryTranslation {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let titleFr = "";
  const numbered: string[] = new Array(n).fill("");
  const others: string[] = [];
  for (const line of lines) {
    const t = line.match(/^TITRE\s*[:：]\s*(.+)$/i);
    if (t) {
      titleFr = titleFr || t[1].trim();
      continue;
    }
    const m = line.match(/^\[?(\d+)\]?[.)、．]\s*(.+)$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < n && !numbered[idx]) numbered[idx] = m[2].trim();
      else others.push(line);
    } else {
      others.push(line);
    }
  }

  // Repli : si la numérotation n'a pas rempli toutes les phrases, on complète dans l'ordre
  // avec les lignes restantes (hors titre).
  let oi = 0;
  for (let i = 0; i < n; i++) {
    if (!numbered[i] && oi < others.length) numbered[i] = others[oi++];
  }
  if (!titleFr) titleFr = others[oi] ?? "Histoire";
  return { titleFr, sentences: numbered };
}

/** Traduit une histoire (phrases JP pré-découpées) en FR aligné + un titre FR court. */
export async function generateStoryTranslation(
  jaSentences: string[],
  level: number,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<StoryTranslation> {
  const n = jaSentences.length;
  if (n === 0) return { titleFr: "Histoire", sentences: [] };

  const numbered = jaSentences.map((s, i) => `[${i + 1}] ${s}`).join("\n");
  const prompt = [
    `Voici une histoire en japonais découpée en ${n} phrases numérotées.`,
    "Donne d'abord un titre court en français, sur une ligne préfixée par « TITRE: ».",
    `Puis traduis CHAQUE phrase en français naturel, une traduction par ligne, dans l'ordre, préfixée par son numéro (« 1. », « 2. », … jusqu'à « ${n}. »). Exactement ${n} lignes de traduction, aucune fusion, aucune phrase sautée.`,
    "Traduis en français PUR : n'inclus AUCUN caractère japonais (kanji/kana), AUCUNE transcription en romaji et AUCUNE glose entre parenthèses (pas de « le chat (猫) », pas de « (neko) »). Traduis tout, y compris les noms communs. Le titre suit la même règle.",
    "Ne renvoie rien d'autre.",
    "",
    numbered,
  ].join("\n");

  const raw = await generateText({ kind: "story", prompt, level }, onState, {
    timeoutMs: opts.timeoutMs ?? 120_000,
  });
  return parseStoryTranslation(raw, n);
}
