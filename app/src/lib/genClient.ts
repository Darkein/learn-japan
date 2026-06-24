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
 * Cadrage pédagogique FR d'une leçon. Le détail structuré (lectures des kanji, règles +
 * exemples de grammaire, liste de vocab) est déjà rendu par l'UI depuis l'inventaire : ce
 * cadrage apporte le liant, l'intuition et les pièges — pas la simple liste.
 */
export async function generateLessonIntro(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const prompt = [
    `Rédige le texte de cadrage d'une leçon de japonais pour un débutant (niveau JLPT N${input.level}) intitulée « ${input.title} ».`,
    "Les éléments à enseigner sont :",
    ...objectivesBlock(input),
    "",
    "Écris une explication pédagogique en FRANÇAIS (5 à 9 phrases, paragraphes courts, **gras** autorisé pour les mots japonais clés) : donne l'intuition, relie les éléments entre eux, illustre par un mini-exemple, et signale un piège fréquent. Ne te contente pas d'énumérer : explique. Pas de titre, pas de liste de vocabulaire brute (elle est affichée à côté). Réponds uniquement avec ce texte FR.",
  ]
    .filter(Boolean)
    .join("\n");

  return (await generateText({ kind: "lesson", prompt, level: input.level }, onState, opts)).trim();
}

/**
 * Longueur cible (caractères JP) d'une histoire, croissante du N5 au N1 avec un
 * plancher minimum garanti. `level` est le numéro JLPT : 5 = N5 … 1 = N1.
 */
function storyLength(level: number): { min: number; max: number } {
  const table: Record<number, { min: number; max: number }> = {
    5: { min: 80, max: 150 },
    4: { min: 120, max: 220 },
    3: { min: 180, max: 300 },
    2: { min: 260, max: 400 },
    1: { min: 350, max: 550 },
  };
  return table[level] ?? table[3];
}

/**
 * Petit texte japonais (mini-article / brève / dialogue) ciblant les objectifs de la
 * leçon, dont la longueur s'adapte au niveau. Privilégie le lexique déjà vu sans
 * l'imposer. Retourne le texte JP brut ; l'appelant le sauve en StoryRecord (lessonId).
 */
export async function generateLessonStory(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const len = storyLength(input.level);
  const prompt = [
    `Écris un texte en japonais pour une leçon de niveau JLPT N${input.level} intitulée « ${input.title} ».`,
    "Format libre — court récit, brève (news), dialogue ou scène du quotidien — du moment que c'est cohérent, naturel et formateur.",
    "Il doit mettre en scène ces éléments cibles :",
    ...objectivesBlock(input),
    input.known?.kanji.length
      ? `Privilégie au maximum le lexique et les kanji déjà connus de l'apprenant : ${input.known.kanji.join("")}. Tu peux introduire un peu de vocabulaire nouveau si c'est nécessaire au naturel du texte, mais reste simple et préfère le déjà-vu (kana au besoin).`
      : "Privilégie un vocabulaire très simple et déjà vu ; un peu de nouveauté reste permise si nécessaire.",
    "",
    `Longueur : un petit article d'environ ${len.min} à ${len.max} caractères japonais (au minimum ${len.min}), en 2 à 4 courts paragraphes.`,
    "Réponds uniquement avec le texte japonais : pas de furigana, pas de romaji, pas de traduction, pas de titre.",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    await generateText(
      { kind: "story", prompt, level: input.level },
      onState,
      // Génération plus longue (texte plus volumineux + repli éventuel de modèle).
      { timeoutMs: opts.timeoutMs ?? 120_000 },
    )
  ).trim();
}
