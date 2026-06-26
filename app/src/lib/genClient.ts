// Client de génération : poste une requête CIBLÉE au Worker, qui répond directement.
// Le Worker (et lui seul) appelle Gemini avec la clé secrète → rien à voler côté client.
//
// SÉCURITÉ — le client n'envoie QUE des paramètres structurés (kind + champs). C'est le
// Worker qui compose le prompt depuis des gabarits fixes (voir worker/src/prompts.ts) :
// aucune instruction libre ne transite, donc l'endpoint ne peut pas être détourné en
// proxy LLM générique « hors japonais ».

import { WORKER_URL } from "./config";

export interface GenParams {
  kind?: "story" | "lesson-intro" | "lesson-story" | "story-translation";
  level?: number;
  // kind: "story" (génération libre du lecteur)
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  // kind: "lesson-intro" | "lesson-story"
  title?: string;
  vocab?: { ja: string; yomi?: string; fr: string }[];
  kanjiGloss?: { ja: string; fr: string }[];
  knownKanji?: string[];
  // kind: "story-translation"
  sentences?: string[];
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
// Dans les deux cas, le client n'envoie que la matière structurée (titre, niveau, vocab,
// kanji, grammaire) ; la mise en forme du prompt est faite par le Worker.

export interface LessonGenInput {
  title: string;
  level: number;
  vocab: { ja: string; yomi?: string; fr: string }[];
  kanji: { ja: string; fr: string }[];
  grammar: string[];
  /** Lexique cumulé déjà connu (leçons précédentes) — contraint l'histoire à du déjà-vu. */
  known?: { kanji: string[] };
}

export async function generateLessonIntro(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  return (
    await generateText(
      {
        kind: "lesson-intro",
        title: input.title,
        level: input.level,
        vocab: input.vocab,
        kanjiGloss: input.kanji,
        grammar: input.grammar,
      },
      onState,
      opts,
    )
  ).trim();
}

export async function generateLessonStory(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  return (
    await generateText(
      {
        kind: "lesson-story",
        title: input.title,
        level: input.level,
        vocab: input.vocab,
        kanjiGloss: input.kanji,
        grammar: input.grammar,
        knownKanji: input.known?.kanji,
      },
      onState,
      // Génération plus longue (texte plus volumineux + repli éventuel de modèle).
      { timeoutMs: opts.timeoutMs ?? 120_000 },
    )
  ).trim();
}

// ---------- Traduction d'histoire (mode podcast : alternance JP / FR) --------
// Pour l'écoute bilingue (SPEC §11), il faut une traduction FR alignée PHRASE PAR PHRASE
// sur le découpage JP. On passe les phrases déjà découpées au Worker, qui exige le même
// nombre de lignes FR → alignement garanti. On obtient aussi un titre FR court (annoncé
// à l'oral). Le parsing de la réponse reste côté client (parseStoryTranslation).

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

  const raw = await generateText(
    { kind: "story-translation", sentences: jaSentences, level },
    onState,
    { timeoutMs: opts.timeoutMs ?? 120_000 },
  );
  return parseStoryTranslation(raw, n);
}
