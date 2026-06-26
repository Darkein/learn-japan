// Mode podcast (SPEC §11) : transforme une leçon en une suite de SEGMENTS audio écoutables —
// cadrage (cours) parlé → quiz variés (français ↔ japonais, avec un blanc) → histoire(s)
// (annonce du titre puis alternance phrase JP / traduction FR) → transition de fin.
//
// Le script est déterministe (zéro LLM pour les quiz et l'assemblage) ; seuls le cadrage,
// la traduction et le titre des histoires viennent du LLM (déjà mis en cache ailleurs).
// L'audio est pré-généré « par pack » et mis en cache (store `tts`) → écoute hors-ligne.

import {
  getPodcast,
  putPodcast,
  putStory,
  type PodcastRecord,
  type StoryRecord,
} from "./db";
import { generateStoryTranslation } from "./genClient";
import {
  addLessonStory,
  ensureLessonFraming,
  getLesson,
  type Lesson,
  type VocabEntry,
} from "./lessons";
import { synthesizeText, TtsUnconfiguredError } from "./ttsClient";

export type PodcastChapter = "cours" | "quiz" | "histoire";

export interface PodcastSegment {
  id: string;
  chapter: PodcastChapter;
  lang: "fr" | "ja";
  /** Texte à synthétiser. */
  text: string;
  /** Blanc (ms) APRÈS ce segment — ex. le silence de réponse d'un quiz. */
  pauseAfterMs?: number;
  /** Libellé court pour la tracklist (sinon dérivé du texte). */
  label?: string;
}

/** Segment avant attribution de l'id global (assigné en fin d'assemblage). */
type RawSegment = Omit<PodcastSegment, "id">;

/** Durée du blanc de réponse d'un quiz (« comment dit-on chat ? » → 5 s → « neko »). */
export const QUIZ_PAUSE_MS = 5000;

/**
 * Version du format de pack. À incrémenter quand l'assemblage du script change (modèles
 * de quiz, transitions…) : un pack en cache d'une version antérieure est régénéré.
 */
export const PACK_VERSION = 2;

// ---------- Français pur (anti double-lecture) ------------------------------

// Plages japonaises : hiragana, katakana, katakana demi-largeur, CJK unifiés.
const JA_CHARS = /[぀-ヿｦ-ﾟ㐀-鿿]/;

/** Vrai si le texte contient au moins un caractère japonais. */
export function containsJa(s: string): boolean {
  return JA_CHARS.test(s);
}

/**
 * Nettoie une traduction française pour la lecture vocale : retire les gloses japonaises
 * (mot japonais / romaji entre parenthèses) et tout caractère japonais résiduel, afin que
 * la voix française ne répète pas un mot déjà prononcé en japonais (ex. « le chat (猫, neko) »).
 */
export function cleanFrench(s: string): string {
  return s
    // Parenthèses contenant du japonais → supprimées en entier (« (猫, neko) »).
    .replace(/[（(][^)）]*[぀-ヿｦ-ﾟ㐀-鿿][^)）]*[)）]/g, "")
    // Caractères japonais isolés résiduels.
    .replace(new RegExp(JA_CHARS.source, "g"), "")
    // Parenthèses vidées et espaces parasites avant ponctuation.
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/\s+([,.;:!?»])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- Découpage des phrases japonaises --------------------------------

const JA_SENTENCE_END = /[。！？．!?]/;

/**
 * Découpe un texte japonais en phrases (sur la ponctuation finale et les sauts de ligne),
 * en conservant la ponctuation. Déterministe → sert à la fois pour la traduction alignée et
 * pour l'assemblage du podcast (mêmes bornes des deux côtés = alignement garanti).
 */
export function splitJaSentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
    if (JA_SENTENCE_END.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------- Quiz de vocabulaire (déterministe, varié) -----------------------

/** Forme japonaise à PRONONCER : le yomi (kana) si présent, jamais un kanji brut. */
function spokenJa(v: VocabEntry): string {
  return v.yomi && v.yomi !== v.ja ? v.yomi : v.ja;
}

/**
 * Construit les segments de quiz à partir du vocabulaire de la leçon. On alterne les
 * modèles pour la variété : production (FR→JP), compréhension (JP→FR), et une variante de
 * production. Chaque question est suivie d'un blanc (`QUIZ_PAUSE_MS`), puis de la réponse.
 */
export function buildVocabQuizzes(vocab: VocabEntry[]): RawSegment[] {
  const segs: RawSegment[] = [];
  vocab.forEach((v, idx) => {
    const ja = spokenJa(v);
    const label = `Quiz · ${v.fr}`;
    switch (idx % 3) {
      case 0: // production FR → JP
        segs.push({ chapter: "quiz", lang: "fr", text: `Comment dit-on « ${v.fr} » en japonais ?`, pauseAfterMs: QUIZ_PAUSE_MS, label });
        segs.push({ chapter: "quiz", lang: "ja", text: ja });
        break;
      case 1: // compréhension JP → FR : amorce FR + mot japonais (voix JA) + réponse FR
        segs.push({ chapter: "quiz", lang: "fr", text: "Que veut dire ce mot ?" });
        segs.push({ chapter: "quiz", lang: "ja", text: ja, pauseAfterMs: QUIZ_PAUSE_MS, label });
        segs.push({ chapter: "quiz", lang: "fr", text: `Cela signifie « ${v.fr} ».` });
        break;
      default: // production, autre formulation
        segs.push({ chapter: "quiz", lang: "fr", text: `Traduisez en japonais : « ${v.fr} ».`, pauseAfterMs: QUIZ_PAUSE_MS, label });
        segs.push({ chapter: "quiz", lang: "ja", text: ja });
        break;
    }
  });
  return segs;
}

// ---------- Assemblage du script --------------------------------------------

/** Allège un paragraphe Markdown pour la lecture vocale (retire **gras**, #, etc.). */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Segment « titre » atomique, séparé des phrases de transition (qui sont fixes) pour que
 * l'un et l'autre soient réutilisables/cacheables indépendamment.
 */
export function titleSegment(text: string, chapter: PodcastChapter): RawSegment {
  return { chapter, lang: "fr", text, label: text };
}

export interface ScriptNav {
  /** Titre de la leçon suivante (annoncé à la fin) ; absent → on boucle au début. */
  nextLessonTitle?: string;
}

/** Assemble le script complet d'une leçon (cours → quiz → histoires → transition de fin). */
export function buildPodcastScript(lesson: Lesson, nav: ScriptNav = {}): PodcastSegment[] {
  const raw: RawSegment[] = [];

  // 1. Cours — cadrage FR (grammaire), un segment par paragraphe.
  if (lesson.framing) {
    for (const para of lesson.framing.split(/\n{2,}/).map(stripMarkdown).filter(Boolean)) {
      raw.push({ chapter: "cours", lang: "fr", text: para, label: "Cours" });
    }
  }

  // 2. Quiz — vocabulaire de la leçon.
  if (lesson.objectives.vocab.length) {
    raw.push({ chapter: "quiz", lang: "fr", text: "Petit quiz pour réviser le vocabulaire.", label: "Quiz" });
    raw.push(...buildVocabQuizzes(lesson.objectives.vocab));
  }

  // 3. Histoire(s) — transition + titre (segments distincts), puis alternance JP / FR.
  lesson.stories.forEach((story, s) => {
    const intro = s === 0 ? "Voici une histoire en rapport avec la leçon :" : "Voici l'histoire suivante :";
    raw.push({ chapter: "histoire", lang: "fr", text: intro, label: `Histoire ${s + 1}` });
    raw.push(titleSegment(story.titleFr ?? story.title, "histoire"));
    const ja = splitJaSentences(story.text);
    const fr = story.translation ?? [];
    ja.forEach((sentence, k) => {
      raw.push({ chapter: "histoire", lang: "ja", text: sentence });
      if (fr[k]) raw.push({ chapter: "histoire", lang: "fr", text: fr[k] });
    });
  });

  // 4. Transition de fin — phrase fixe + titre en segments séparés (ou boucle au début).
  if (nav.nextLessonTitle) {
    raw.push({ chapter: "histoire", lang: "fr", text: "Passons à la leçon suivante :", label: "Suite" });
    raw.push(titleSegment(nav.nextLessonTitle, "histoire"));
  } else {
    raw.push({ chapter: "histoire", lang: "fr", text: "Recommençons depuis le début.", label: "Fin" });
  }

  return raw.map((s, i) => ({ id: `${s.chapter}-${i}`, ...s }));
}

// ---------- Traduction d'histoire (préalable à l'assemblage) -----------------

/** Une traduction est exploitable si elle est présente, complète et SANS japonais résiduel. */
function translationIsClean(story: StoryRecord): boolean {
  if (!story.translation?.length || !story.titleFr) return false;
  return !containsJa(story.titleFr) && !story.translation.some(containsJa);
}

/**
 * S'assure qu'une histoire a une traduction FR alignée + un titre FR, **en français pur**.
 * Régénère si elle manque OU si une ancienne traduction contient encore du japonais
 * (auto-réparation des packs générés avant le durcissement du prompt). Nettoie en plus
 * défensivement (`cleanFrench`) pour ne jamais relire un mot déjà prononcé en japonais.
 */
export async function ensureStoryTranslation(story: StoryRecord): Promise<StoryRecord> {
  if (translationIsClean(story)) return story;
  const ja = splitJaSentences(story.text);
  const { titleFr, sentences } = await generateStoryTranslation(ja, story.params.level ?? 5);
  const updated: StoryRecord = {
    ...story,
    titleFr: cleanFrench(titleFr),
    translation: sentences.map(cleanFrench),
  };
  await putStory(updated);
  return updated;
}

// ---------- Pré-génération du pack -------------------------------------------

export interface PackProgress {
  (message: string): void;
}

/**
 * Pré-génère le pack podcast d'une leçon : s'assure que le cadrage + au moins une histoire
 * (traduite) existent, assemble le script, préchauffe l'audio (cache `tts`), et enregistre
 * le script. Si le Worker n'a pas de clé TTS, on enregistre quand même le script (le lecteur
 * basculera sur la Web Speech API).
 */
export async function generatePodcastPack(
  lessonId: string,
  nav: ScriptNav = {},
  onProgress?: PackProgress,
): Promise<PodcastRecord> {
  let lesson = await getLesson(lessonId);
  if (!lesson) throw new Error(`Leçon introuvable : ${lessonId}`);

  onProgress?.("Préparation du cours…");
  await ensureLessonFraming(lesson);

  if (lesson.stories.length === 0) {
    onProgress?.("Génération d'une histoire…");
    await addLessonStory(lesson);
    lesson = (await getLesson(lessonId))!;
  }

  for (const story of lesson.stories) {
    // ensureStoryTranslation décide elle-même (manquante ou « sale » → régénère).
    onProgress?.("Traduction de l'histoire…");
    await ensureStoryTranslation(story);
  }
  lesson = (await getLesson(lessonId))!; // re-hydrate avec traductions/titres à jour

  const segments = buildPodcastScript(lesson, nav);

  // Préchauffe l'audio segment par segment (mise en cache). On s'arrête proprement si le
  // TTS n'est pas configuré : le script reste utilisable via la Web Speech API.
  const spoken = segments.filter((s) => s.text.trim());
  let done = 0;
  for (const s of spoken) {
    onProgress?.(`Synthèse audio… ${++done}/${spoken.length}`);
    try {
      await synthesizeText(s.text, s.lang);
    } catch (e) {
      if (e instanceof TtsUnconfiguredError) break;
      throw e;
    }
  }

  const rec: PodcastRecord = { id: lessonId, segments, createdAt: Date.now(), version: PACK_VERSION };
  await putPodcast(rec);
  return rec;
}

/** Récupère un pack déjà généré (ou undefined). */
export async function getPodcastPack(lessonId: string): Promise<PodcastRecord | undefined> {
  return getPodcast(lessonId);
}
