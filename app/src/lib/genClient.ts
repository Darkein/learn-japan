// Client de génération : poste une requête CIBLÉE au Worker, qui répond directement.
// Le Worker (et lui seul) appelle Gemini avec la clé secrète → rien à voler côté client.
//
// SÉCURITÉ — le client n'envoie QUE des paramètres structurés (kind + champs). C'est le
// Worker qui compose le prompt depuis des gabarits fixes (voir worker/src/prompts.ts) :
// aucune instruction libre ne transite, donc l'endpoint ne peut pas être détourné en
// proxy LLM générique « hors japonais ».

import { WORKER_URL } from "./config";
import {
  parseComprehensionQcm,
  parseStoryTranslation,
  type ComprehensionQuestion,
  type StoryTranslation,
} from "./genParsers";

export type { ComprehensionQuestion, StoryTranslation };

export interface GenParams {
  kind?: "story" | "lesson" | "lesson-story" | "story-translation" | "comprehension-qcm";
  level?: number;
  // kind: "story" (génération libre du lecteur)
  theme?: string;
  grammar?: string[];
  // kind: "lesson" | "lesson-story"
  title?: string;
  vocab?: { ja: string; yomi?: string; fr: string }[];
  // kind: "lesson-story" — révision (leçons précédentes, pondérée plus bas) et anti-répétition.
  reviewVocab?: { ja: string; yomi?: string; fr: string }[];
  reviewGrammar?: string[];
  avoidTitles?: string[];
  // kind: "story-translation"
  sentences?: string[];
  // Clé R2 structurée (lesson / lesson-story uniquement)
  lessonId?: string;
  variant?: number;
  /** Ignorer le cache R2 du Worker et régénérer (cours périmé après changement de curriculum). */
  refresh?: boolean;
}

export type GeneratedIndex = Record<string, { cours: boolean; stories: number[] }>;

/**
 * Récupère la liste de tout le contenu pré-généré depuis le Worker.
 * Doit être appelé une seule fois au démarrage ; échec réseau → {} (dégradé local-only).
 */
export async function fetchGenerated(): Promise<GeneratedIndex> {
  try {
    const res = await fetch(`${WORKER_URL}/generated`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { lessons?: GeneratedIndex };
    return data.lessons ?? {};
  } catch {
    return {};
  }
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

  let res: Response | undefined;
  let networkError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise<void>((r) => setTimeout(r, attempt * 1500));
    networkError = undefined;
    try {
      res = await fetch(`${WORKER_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "story", ...params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      break;
    } catch (e) {
      networkError = new Error(`Worker injoignable : ${String(e)}`);
    }
  }
  if (!res) {
    onState?.("error");
    throw networkError!;
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
//  - generateLesson → une LEÇON FR rédigée (corps pédagogique) qui complète le détail
//    structuré assemblé depuis l'inventaire ;
//  - generateLessonStory → une HISTOIRE JP, contrainte au lexique déjà vu, sauvée en StoryRecord.
// Dans les deux cas, le client n'envoie que la matière structurée (titre, niveau, vocab,
// kanji, grammaire) ; la mise en forme du prompt est faite par le Worker.

export interface LessonGenInput {
  lessonId: string;
  title: string;
  level: number;
  vocab: { ja: string; yomi?: string; fr: string }[];
  grammar: string[];
  /**
   * Ignorer le cache R2 du Worker et régénérer. Nécessaire quand les objectifs de la
   * leçon ont changé : les clés R2 des cours sont par id (gen/lesson/<id>.json), le
   * cache resservirait sinon l'ancien contenu.
   */
  refresh?: boolean;
  // kind: "lesson-story" uniquement — révision (leçons précédentes) et anti-répétition.
  reviewVocab?: { ja: string; yomi?: string; fr: string }[];
  reviewGrammar?: string[];
  avoidTitles?: string[];
}

export async function generateLesson(
  input: LessonGenInput,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  return (
    await generateText(
      {
        kind: "lesson",
        lessonId: input.lessonId,
        title: input.title,
        level: input.level,
        vocab: input.vocab,
        grammar: input.grammar,
        ...(input.refresh ? { refresh: true } : {}),
      },
      onState,
      opts,
    )
  ).trim();
}

export async function generateLessonStory(
  input: LessonGenInput,
  variant: number,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  return (
    await generateText(
      {
        kind: "lesson-story",
        lessonId: input.lessonId,
        variant,
        title: input.title,
        level: input.level,
        vocab: input.vocab,
        grammar: input.grammar,
        reviewVocab: input.reviewVocab,
        reviewGrammar: input.reviewGrammar,
        avoidTitles: input.avoidTitles,
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

// ---------- QCM de compréhension (LLM) --------------------------------------
// Vérifie qu'on a compris le SENS d'une histoire : 4 questions FR à choix multiple,
// chacune taguée du point de grammaire qu'elle teste ([G1], [G2]…) → notation SRS
// par point (piste « compréhension »). Le Worker compose le prompt ; ce module ne
// fait que poster les paramètres structurés et parser le texte renvoyé.

/** Génère un QCM de compréhension à partir des phrases JP + des points de grammaire. */
export async function generateComprehensionQcm(
  jaSentences: string[],
  level: number,
  grammar: { ids: string[]; labels: string[] },
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<ComprehensionQuestion[]> {
  if (jaSentences.length === 0) return [];
  const raw = await generateText(
    { kind: "comprehension-qcm", sentences: jaSentences, level, grammar: grammar.labels },
    onState,
    { timeoutMs: opts.timeoutMs ?? 120_000 },
  );
  return parseComprehensionQcm(raw, grammar.ids);
}
