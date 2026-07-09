// Assemblage PUR du script podcast (SPEC §11) : cadrage (cours) parlé → quiz variés
// (français ↔ japonais, avec un blanc) → histoire(s) (annonce du titre puis alternance
// phrase JP / traduction FR) → transition de fin.
//
// Déterministe, zéro effet (pas de LLM, pas d'IndexedDB) → testable en Node. La partie
// « effets » (traduction LLM, pré-génération audio du pack) vit dans lib/podcast.ts.

import type { ComprehensionQuestion } from "./genClient";
import { isKana, isKanji, splitJaSentences } from "./kana";
import type { VocabEntry } from "./curriculum";
import type { Lesson } from "./lessons";

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
  /** Surfaces des tokens de la phrase (histoire) : active la synthèse avec timepoints. */
  tokens?: string[];
  /** Index GLOBAL du 1er token de la phrase (surlignage). */
  baseTokenIndex?: number;
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
export const PACK_VERSION = 5;

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
    const label = "Quiz";
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

/**
 * Retire les marqueurs STRUCTURELS d'une ligne Markdown qui ne doivent jamais être lus à
 * voix haute : fences de conteneur (`:::example`, `:::summary`, `:::`…), règles horizontales
 * et lignes de séparation de tableau (`---`, `***`, `|---|:--:|`), citation de tête (`> `) et
 * barres verticales des tableaux. Renvoie "" si la ligne n'était QUE de la structure.
 */
function stripBlockMarkers(line: string): string {
  let s = line.trim();
  if (/^:::/.test(s)) return ""; // fence de conteneur (ouvrante ou fermante)
  if (/^[|\s]*[-*_:]{3,}[-*_:|\s]*$/.test(s)) return ""; // règle horizontale / séparateur de tableau
  s = s.replace(/^>+\s?/, ""); // citation Markdown (préfixe des traductions d'exemple)
  if (s.includes("|")) s = s.replace(/\|/g, " "); // cellules de tableau
  return s.trim();
}

/** Allège un paragraphe Markdown pour la lecture vocale (retire **gras**, #, etc.). */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Parenthèse ne contenant QUE du kana (+ ー・ et espaces) = furigana ajouté au mot japonais.
const FURIGANA_PARENS = /[（(][\s぀-ヿｦ-ﾟ]+[)）]/g;

/**
 * Retire le furigana entre parenthèses d'un texte japonais (« 私（わたし） » → « 私 »). Sans
 * cela, la voix japonaise prononcerait DEUX fois le mot (le kanji puis sa lecture kana). On
 * ne touche pas aux parenthèses contenant des kanji ou du latin : ce n'est pas du furigana.
 */
export function stripFurigana(s: string): string {
  return s.replace(FURIGANA_PARENS, "").replace(/\s{2,}/g, " ").trim();
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
 * Découpe une ligne de prose FRANÇAISE qui contient des mots japonais inline (ex. « La
 * particule は marque le thème ») en segments alternés : le texte latin part en voix
 * française, les fragments japonais en voix japonaise — sinon la voix française écorche le
 * japonais (は lu « ka »). Le furigana entre parenthèses est d'abord retiré.
 */
function proseSegments(text: string, label = "Cours"): RawSegment[] {
  const clean = stripFurigana(stripMarkdown(text));
  if (!clean) return [];
  const out: RawSegment[] = [];
  let buf = "";
  let lang: "fr" | "ja" | null = null; // langue du fragment en cours (ponctuation = neutre)
  const flush = () => {
    const t = buf.trim();
    if (t) out.push({ chapter: "cours", lang: lang === "ja" ? "ja" : "fr", text: t, label });
    buf = "";
  };
  for (const ch of clean) {
    const cls = isKana(ch) || isKanji(ch) ? "ja" : /[A-Za-zÀ-ÿ0-9]/.test(ch) ? "fr" : null;
    if (cls && lang && cls !== lang) flush(); // bascule de langue → on coupe le fragment
    if (cls) lang = cls;
    buf += ch;
  }
  flush();
  return out;
}

/**
 * Transforme la leçon FR (Markdown, avec exemples japonais) en segments parlés :
 *  - structure (fences `:::…`, règles `---`, pipes de tableau) → retirée, jamais lue ;
 *  - prose française → segments FR, les mots JP inline étant routés en voix japonaise ;
 *  - exemple `:::example` (phrase JP puis sa traduction FR préfixée par « > ») → la phrase JP
 *    en voix japonaise (furigana retiré) puis sa traduction FR en voix française.
 */
function coursSegments(framing: string): RawSegment[] {
  const out: RawSegment[] = [];
  let currentLabel = "Cours";
  for (const block of framing.split(/\n{2,}/)) {
    const rawFirstLine = block.split("\n")[0].trim();
    if (/^##\s/.test(rawFirstLine)) {
      currentLabel = stripMarkdown(rawFirstLine).trim() || "Cours";
    }
    const lines = block
      .split("\n")
      .filter((raw) => !/^#{3,}\s/.test(raw.trim()))
      .map(stripBlockMarkers)
      .filter(Boolean);
    if (!lines.length) continue;
    if (!lines.some(isJapaneseLine)) {
      out.push(...proseSegments(lines.join(" "), currentLabel));
      continue;
    }
    for (const line of lines) {
      if (isJapaneseLine(line)) {
        const text = stripFurigana(stripMarkdown(line));
        if (text) out.push({ chapter: "cours", lang: "ja", text, label: currentLabel });
      } else {
        out.push(...proseSegments(line, currentLabel));
      }
    }
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
    // Furigana retiré : la voix japonaise ne doit pas relire la lecture entre parenthèses.
    const ja = splitJaSentences(story.text).map(stripFurigana);
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
