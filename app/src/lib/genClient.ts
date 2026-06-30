// Client de génération : poste une requête CIBLÉE au Worker, qui répond directement.
// Le Worker (et lui seul) appelle Gemini avec la clé secrète → rien à voler côté client.
//
// SÉCURITÉ — le client n'envoie QUE des paramètres structurés (kind + champs). C'est le
// Worker qui compose le prompt depuis des gabarits fixes (voir worker/src/prompts.ts) :
// aucune instruction libre ne transite, donc l'endpoint ne peut pas être détourné en
// proxy LLM générique « hors japonais ».

import { WORKER_URL } from "./config";

export interface GenParams {
  kind?: "story" | "lesson" | "lesson-story" | "story-translation" | "comprehension-qcm";
  level?: number;
  // kind: "story" (génération libre du lecteur)
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  // kind: "lesson" | "lesson-story"
  title?: string;
  vocab?: { ja: string; yomi?: string; fr: string }[];
  kanjiGloss?: { ja: string; fr: string }[];
  knownKanji?: string[];
  // kind: "story-translation"
  sentences?: string[];
  // Clé R2 structurée (lesson / lesson-story uniquement)
  lessonId?: string;
  variant?: number;
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
  kanji: { ja: string; fr: string }[];
  grammar: string[];
  /** Lexique cumulé déjà connu (leçons précédentes) — contraint l'histoire à du déjà-vu. */
  known?: { kanji: string[] };
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

// ---------- QCM de compréhension (LLM) --------------------------------------
// Vérifie qu'on a compris le SENS d'une histoire : 4 questions FR à choix multiple,
// chacune taguée du point de grammaire qu'elle teste ([G1], [G2]…) → notation SRS
// par point (piste « compréhension »). Le Worker compose le prompt ; ce module ne
// fait que poster les paramètres structurés et parser le texte renvoyé.

export interface ComprehensionQuestion {
  /** Énoncé en français. */
  question: string;
  /** Propositions en français, déjà mélangées. */
  options: string[];
  /** Index de la bonne proposition dans `options`. */
  answerIndex: number;
  /** Point de grammaire testé (résolu depuis le tag [Gk]) ; absent si compréhension générale. */
  targetGrammarId?: string;
}

/** Mélange un tableau (Fisher-Yates) en renvoyant aussi le nouvel index d'un élément suivi. */
function shuffleTracking<T>(items: T[], trackedIndex: number): { items: T[]; index: number } {
  const arr = items.slice();
  let tracked = trackedIndex;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
    if (i === tracked) tracked = j;
    else if (j === tracked) tracked = i;
  }
  return { items: arr, index: tracked };
}

/**
 * Extrait les questions du QCM renvoyé par le modèle (robuste au bruit). Une ligne
 * « N. [Gk] énoncé » ouvre une question ; les lignes « + … » / « - … » sont ses
 * propositions (« + » = bonne réponse). `grammarIds` (ordonné) résout le tag [Gk] → id
 * (k=0 ou absent ⇒ pas de point précis). Les questions sans bonne réponse ou avec moins
 * de deux propositions sont ignorées.
 */
export function parseComprehensionQcm(
  raw: string,
  grammarIds: string[] = [],
): ComprehensionQuestion[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  interface Draft {
    question: string;
    targetGrammarId?: string;
    options: string[];
    correct: number;
  }
  const drafts: Draft[] = [];
  let cur: Draft | null = null;

  for (const line of lines) {
    const q = line.match(/^\[?(\d+)\]?(?:[.)、．]|\s)\s*(?:\[\s*[Gg]\s*(\d+)\s*\]\s*)?(.+)$/);
    if (q) {
      cur = { question: q[3].trim(), options: [], correct: -1 };
      const gk = q[2] ? Number(q[2]) : 0;
      if (gk >= 1 && gk <= grammarIds.length) cur.targetGrammarId = grammarIds[gk - 1];
      drafts.push(cur);
      continue;
    }
    const o = line.match(/^([+\-*•])\s*(.+)$/);
    if (o && cur) {
      const good = o[1] === "+" || o[1] === "*";
      if (good && cur.correct < 0) cur.correct = cur.options.length;
      cur.options.push(o[2].trim());
    }
  }

  const out: ComprehensionQuestion[] = [];
  for (const d of drafts) {
    if (d.options.length < 2 || d.correct < 0) continue;
    const { items, index } = shuffleTracking(d.options, d.correct);
    out.push({
      question: d.question,
      options: items,
      answerIndex: index,
      targetGrammarId: d.targetGrammarId,
    });
  }
  return out;
}

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
