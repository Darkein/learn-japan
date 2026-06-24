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

// ---------- Génération de leçon (intro FR + histoire JP) --------------------

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

export interface LessonGenOutput {
  intro: string;
  storyJa: string;
}

const SEP = "===STORY_JA===";

/**
 * Demande au Worker (Gemini) de produire une mini-leçon FR + une histoire courte JP
 * ciblant les objectifs. Pour rester compatible avec l'endpoint /generate actuel
 * (qui ne sait répondre que `{ text }`), on demande un format avec un séparateur
 * fixe et on splitte côté client. Pas de JSON imposé au modèle (plus fragile).
 */
export async function generateLesson(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<LessonGenOutput> {
  const prompt = [
    `Produis une mini-leçon de japonais pour un débutant (niveau JLPT N${input.level}) intitulée « ${input.title} ».`,
    input.vocab.length ? `Vocabulaire à introduire : ${input.vocab.map(fmtVocab).join(", ")}.` : "",
    input.kanji.length ? `Kanji à introduire : ${input.kanji.map(fmtKanji).join(", ")}.` : "",
    input.grammar.length ? `Points de grammaire : ${input.grammar.join(", ")}.` : "",
    input.known?.kanji.length
      ? `Cohérence : en dehors des kanji cibles ci-dessus, n'emploie QUE des kanji déjà connus de l'apprenant : ${input.known.kanji.join("")}. N'introduis aucun autre kanji (préfère le kana au besoin), et reste avec du vocabulaire simple déjà vu.`
      : "",
    "",
    "Réponds en DEUX parties séparées par exactement cette ligne :",
    SEP,
    "",
    "Partie 1 : une explication pédagogique en FRANÇAIS (3 à 6 phrases), claire, sans jargon, qui présente les éléments ci-dessus.",
    "Partie 2 : une COURTE histoire en JAPONAIS (2 à 4 phrases) qui utilise les éléments ci-dessus. Pas de furigana, pas de romaji, pas de traduction.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateText({ kind: "lesson", prompt, level: input.level }, onState, opts);
  const idx = raw.indexOf(SEP);
  if (idx < 0) {
    // Le modèle n'a pas respecté la consigne — repli : tout traiter comme histoire.
    return { intro: "", storyJa: raw.trim() };
  }
  return {
    intro: raw.slice(0, idx).trim(),
    storyJa: raw.slice(idx + SEP.length).trim(),
  };
}
