// Mode podcast (SPEC §11) : transforme une leçon en une suite de SEGMENTS audio écoutables —
// cadrage (cours) parlé → quiz variés (français ↔ japonais, avec un blanc) → histoire(s)
// (annonce du titre puis alternance phrase JP / traduction FR) → transition de fin.
//
// Le script est déterministe (zéro LLM pour les quiz et l'assemblage) ; seuls le cadrage,
// la traduction et le titre des histoires viennent du LLM (déjà mis en cache ailleurs).
// L'audio est pré-généré « par pack » et mis en cache (store `tts`) → écoute hors-ligne.

import {
  getPodcast,
  getStory,
  putPodcast,
  putStory,
  type PodcastRecord,
  type StoryRecord,
} from "./db";
import { generateStoryTranslation, type ComprehensionQuestion } from "./genClient";
import { isKana, isKanji } from "./kana";
import {
  addLessonStory,
  ensureLessonFraming,
  getLesson,
  type Lesson,
  type VocabEntry,
} from "./lessons";
import { ensureComprehensionQuiz } from "./stories";
import { synthesizeText, TtsUnconfiguredError } from "./ttsClient";

export type PodcastChapter = "cours" | "quiz" | "histoire" | "comprehension";

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

/** Blanc de réflexion d'une question de compréhension (4 options à soupeser → plus long). */
export const COMP_PAUSE_MS = 8000;

/**
 * Version du format de pack. À incrémenter quand l'assemblage du script change (modèles
 * de quiz, transitions…) : un pack en cache d'une version antérieure est régénéré.
 */
export const PACK_VERSION = 3;

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

// ---------- Quiz de compréhension (audio, passif) ---------------------------

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Segments audio d'un QCM de compréhension (LLM) : intro, puis par question l'énoncé,
 * les options « A : … », « B : … »…, un blanc de réflexion (`COMP_PAUSE_MS`) après la
 * dernière option, et l'annonce de la bonne réponse. Tout en français (mode voiture,
 * passif : pas de saisie → pas de SRS ici, comme le quiz vocab).
 */
export function buildComprehensionAudio(questions: ComprehensionQuestion[]): RawSegment[] {
  if (questions.length === 0) return [];
  const segs: RawSegment[] = [
    { chapter: "comprehension", lang: "fr", text: "Petit quiz de compréhension sur l'histoire.", label: "Compréhension" },
  ];
  questions.forEach((q, qi) => {
    segs.push({ chapter: "comprehension", lang: "fr", text: `Question ${qi + 1}. ${q.question}`, label: `Question ${qi + 1}` });
    q.options.forEach((opt, oi) => {
      const last = oi === q.options.length - 1;
      segs.push({
        chapter: "comprehension",
        lang: "fr",
        text: `${OPTION_LETTERS[oi] ?? oi + 1} : ${opt}`,
        ...(last ? { pauseAfterMs: COMP_PAUSE_MS } : {}),
      });
    });
    const letter = OPTION_LETTERS[q.answerIndex] ?? String(q.answerIndex + 1);
    segs.push({
      chapter: "comprehension",
      lang: "fr",
      text: `Bonne réponse : ${letter}. ${q.options[q.answerIndex]}`,
    });
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
 * Vrai si la LIGNE est une phrase japonaise (à dominante kana/kanji), par opposition à une
 * ligne française qui ne contiendrait qu'un mot japonais inline (ex. « La copule です … »).
 * Sert à router la voix TTS : seules les lignes à dominante JP passent en voix japonaise.
 */
function isJapaneseLine(s: string): boolean {
  let ja = 0;
  let latin = 0;
  for (const ch of s) {
    if (isKana(ch) || isKanji(ch)) ja++;
    else if (/[A-Za-zÀ-ÿ]/.test(ch)) latin++;
  }
  return ja > 0 && ja >= latin;
}

/**
 * Transforme la leçon FR (Markdown, avec exemples japonais) en segments parlés :
 *  - prose française → un segment FR par paragraphe (les mots JP inline restent dans le flux FR) ;
 *  - exemple « phrase JP / lecture romaji / traduction FR » → la phrase JP (voix japonaise)
 *    puis sa traduction FR ; la ligne romaji du milieu est sautée (redondante avec le TTS JA).
 * Une ligne française coincée entre une phrase JP et une autre ligne française est considérée
 * comme la lecture romaji et n'est donc pas lue.
 */
function coursSegments(framing: string): RawSegment[] {
  const out: RawSegment[] = [];
  for (const block of framing.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (!lines.some(isJapaneseLine)) {
      // Prose pure : un seul segment FR pour tout le paragraphe.
      const text = stripMarkdown(lines.join(" "));
      if (text) out.push({ chapter: "cours", lang: "fr", text, label: "Cours" });
      continue;
    }
    // Bloc d'exemple : ligne par ligne, en routant la voix selon la langue.
    lines.forEach((line, i) => {
      if (isJapaneseLine(line)) {
        const text = stripMarkdown(line);
        if (text) out.push({ chapter: "cours", lang: "ja", text, label: "Cours" });
        return;
      }
      const prevJa = i > 0 && isJapaneseLine(lines[i - 1]);
      const nextFr = i < lines.length - 1 && !isJapaneseLine(lines[i + 1]);
      if (prevJa && nextFr) return; // lecture romaji entre la phrase JP et sa traduction → sautée
      const text = stripMarkdown(line);
      if (text) out.push({ chapter: "cours", lang: "fr", text, label: "Cours" });
    });
  }
  return out;
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

  // 1. Cours — leçon FR (grammaire) parlée, segmentée pour gérer les exemples japonais.
  if (lesson.framing) raw.push(...coursSegments(lesson.framing));

  // 2. Quiz — vocabulaire de la leçon.
  if (lesson.objectives.vocab.length) {
    raw.push({ chapter: "quiz", lang: "fr", text: "Petit quiz pour réviser le vocabulaire.", label: "Quiz" });
    raw.push(...buildVocabQuizzes(lesson.objectives.vocab));
  }

  // 3. Histoire(s) — transition + titre (segments distincts). Si un QCM de compréhension
  //    existe : 1re écoute en japonais SEUL → QCM → 2e écoute japonais + français (la
  //    compréhension n'aurait aucun sens si le français était lu d'emblée). Sinon : repli
  //    sur la lecture bilingue unique (pas de double lecture inutile).
  lesson.stories.forEach((story, s) => {
    const intro = s === 0 ? "Voici une histoire en rapport avec la leçon :" : "Voici l'histoire suivante :";
    raw.push({ chapter: "histoire", lang: "fr", text: intro, label: `Histoire ${s + 1}` });
    raw.push(titleSegment(story.titleFr ?? story.title, "histoire"));
    const ja = splitJaSentences(story.text);
    const fr = story.translation ?? [];
    const questions = story.comprehension ?? [];

    if (questions.length > 0) {
      // 1re écoute : japonais seul.
      raw.push({ chapter: "histoire", lang: "fr", text: "D'abord, écoutez l'histoire en japonais.", label: "Japonais" });
      ja.forEach((sentence) => raw.push({ chapter: "histoire", lang: "ja", text: sentence }));
      // QCM de compréhension audio.
      raw.push(...buildComprehensionAudio(questions));
      // 2e écoute : japonais puis français.
      raw.push({ chapter: "histoire", lang: "fr", text: "Réécoutons, en japonais puis en français.", label: "Japonais + français" });
    }

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

/**
 * Traduction FR fluide d'une histoire (titre + phrases alignées), avec cache partagé sur le
 * `StoryRecord` (mêmes champs que le podcast). Réutilisée par le lecteur texte pour afficher la
 * « vraie » traduction (≠ gloss mot-à-mot) après le quiz. Histoire non enregistrée (lecteur
 * libre) → génère sans persister.
 */
export async function ensureStoryTranslationById(
  storyId: string | undefined,
  text: string,
  level: number,
): Promise<{ titleFr: string; sentences: string[] }> {
  if (storyId) {
    const story = await getStory(storyId);
    if (story) {
      const updated = await ensureStoryTranslation(story);
      return { titleFr: updated.titleFr ?? "", sentences: updated.translation ?? [] };
    }
  }
  const { titleFr, sentences } = await generateStoryTranslation(splitJaSentences(text), level);
  return { titleFr: cleanFrench(titleFr), sentences: sentences.map(cleanFrench) };
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
    await addLessonStory(lesson, 1);
    lesson = (await getLesson(lessonId))!;
  }

  for (const story of lesson.stories) {
    // ensureStoryTranslation décide elle-même (manquante ou « sale » → régénère).
    onProgress?.("Traduction de l'histoire…");
    await ensureStoryTranslation(story);
  }

  // QCM de compréhension par histoire (best-effort) : peuple le cache `StoryRecord.comprehension`
  // avant l'assemblage → la passe « japonais seul + quiz + bilingue » s'active. En cas d'échec
  // (hors-ligne / clé absente), on poursuit sans : l'histoire retombe sur la lecture bilingue.
  const grammar = { ids: lesson.introduces.grammar, labels: lesson.objectives.grammar };
  for (const story of lesson.stories) {
    onProgress?.("Quiz de compréhension…");
    try {
      await ensureComprehensionQuiz(story.id, story.text, story.params.level ?? lesson.level, grammar);
    } catch {
      // QCM indisponible → repli sur la passe bilingue unique (sans chapitre Compréhension).
    }
  }

  lesson = (await getLesson(lessonId))!; // re-hydrate avec traductions/titres/QCM à jour

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
