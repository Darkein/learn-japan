// Contrôle de fin de leçon — le 関所 (sekisho), poste de barrière du Tōkaidō : on ne passe
// à la leçon suivante qu'en franchissant la barrière. C'est une ÉPREUVE, pas une session
// de révision de plus (SPEC §5b). Quatre différences dures avec `buildSession` :
//   - AUCUNE correction pendant l'épreuve : on répond à tout, puis on rend la copie ;
//   - AUCUNE auto-notation (Difficile/Bien/Facile) : c'est l'app qui note, pas l'élève ;
//   - béquilles coupées : pas de QCM là où la saisie est possible, écoutes comptées,
//     pas d'échappatoire « Afficher le texte », pas de traduction à la demande ;
//   - un barème par exercice, une note /20, une mention, une copie corrigée.
//
// Le sujet ne sort QUE de la leçon (son vocabulaire, sa grammaire) : les histoires n'y
// entrent pas — on vérifie ce qui a été ENSEIGNÉ, pas ce qui a été lu.
//
// RÈGLE DURE : le tirage du sujet est DÉTERMINISTE (seed = leçon + n° de tentative,
// mulberry32 inline comme lib/omikuji.ts) — jamais Math.random ni random.ts (non seedé).
// Rouvrir une épreuve interrompue redonne le MÊME sujet, un rattrapage en donne un autre,
// et les tests rejouent une tentative à l'identique.

import { toHiragana } from "wanakana";
import { isAcceptableOrder } from "./buildOrders";
import { isCorrectOrder, toTiles } from "./builder";
import { EXAM } from "./config";
import {
  allReviews,
  allVocab,
  bumpSrsDaily,
  examsForLesson,
  getGrammar,
  getLessonProgress,
  localDateString,
  putExam,
  putLessonProgress,
  type ExamRecord,
  type GrammarItem,
  type Skill,
  type VocabItem,
} from "./db";
import { gradeExercise, type Exercise, type ExerciseTrack } from "./exercise";
import { neighborRules, sentenceSpeechText } from "./exerciseBuild";
import type { ComprehensionQuestion } from "./genClient";
import { grammarDetail } from "./inventory";
import { answerVariants, normalizeReading } from "./kana";
import { wordSpeechText } from "./speech";
import { addTokaidoBonus } from "./tokaido";
import type { KuromojiToken } from "./tokenizer";
import { isNearMiss } from "./typo";
import { effectiveExample } from "./vocab";
import { faceText } from "./vocabFaces";

// ---- Modèle -------------------------------------------------------------------

export type ExamSectionId =
  | "dictee"
  | "lecture"
  | "version"
  | "theme"
  | "grammaire"
  | "comprehension";

export interface ExamQuestion {
  /** Clé stable dans la copie (= `exercise.key`). */
  key: string;
  section: ExamSectionId;
  /** Points de la question au barème. */
  points: number;
  /** L'exercice lui-même — même modèle que la révision (lib/exercise.ts), servi sans
   *  correction immédiate et noté par `gradeExam`. */
  exercise: Exercise;
}

export interface ExamSection {
  id: ExamSectionId;
  /** « Exercice 2 — Lecture ». */
  title: string;
  instruction: string;
  /** Matière à lire avant de répondre (texte de compréhension). */
  preamble?: string;
  questions: ExamQuestion[];
  /** Total du barème de la section (somme des questions). */
  points: number;
}

/** Section retirée du sujet faute de matière — le barème est ramené d'autant. */
export interface SkippedSection {
  id: ExamSectionId;
  reason: string;
}

export interface Exam {
  lessonId: string;
  /** N° de tentative (1 = premier passage) : entre dans le seed du tirage. */
  attempt: number;
  sections: ExamSection[];
  /** Barème réel de CE sujet (somme des sections retenues) — la note reste sur 20. */
  maxPoints: number;
  skipped: SkippedSection[];
}

/** Réponse de l'élève : index d'option (QCM), texte saisi, ou suite de tuiles posées. */
export type ExamAnswer = number | string | string[] | null;
export type ExamAnswers = Record<string, ExamAnswer>;

/** Verdict d'une question : juste, « presque » (coquille, demi-point), ou faux. */
export type ExamVerdict = "correct" | "almost" | "wrong";

export interface QuestionResult {
  key: string;
  section: ExamSectionId;
  /** Énoncé tel qu'affiché (pour relire la copie sans reconstruire le sujet). */
  prompt: string;
  verdict: ExamVerdict;
  points: number;
  maxPoints: number;
  /** Réponse donnée, en clair ; vide si l'élève a laissé blanc. */
  given: string;
  expected: string;
  /** Item SRS derrière la question (replanification + ouverture du rattrapage). */
  itemId: string;
  track: ExerciseTrack;
  skill?: Skill;
}

export interface ExamResult {
  lessonId: string;
  attempt: number;
  results: QuestionResult[];
  obtained: number;
  max: number;
  /** Note ramenée sur 20, au demi-point. */
  note: number;
  mention: string;
  passed: boolean;
  /** Score par section, dans l'ordre du sujet. */
  sections: { id: ExamSectionId; title: string; obtained: number; max: number }[];
}

// ---- Tirage déterministe -------------------------------------------------------

/** mulberry32 : PRNG minuscule, seedé par le hash de (leçon, tentative). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher-Yates seedé — l'équivalent de `shuffle` (random.ts) sous PRNG contrôlé. */
function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Tirage sans remise à l'échelle du SUJET : un mot déjà interrogé dans un exercice
 * précédent ne repasse dans un autre que si la leçon n'a pas assez de matière — un
 * contrôle qui pose quatre fois le même mot n'apprend rien sur le reste de la leçon.
 */
function makePicker(rng: () => number) {
  const used = new Set<string>();
  return function pick<T extends { id: string }>(pool: readonly T[], n: number): T[] {
    const fresh = seededShuffle(pool.filter((p) => !used.has(p.id)), rng);
    const reused = seededShuffle(pool.filter((p) => used.has(p.id)), rng);
    const chosen = [...fresh, ...reused].slice(0, n);
    for (const c of chosen) used.add(c.id);
    return chosen;
  };
}

/** Options mélangées avec l'index de la bonne réponse, sous PRNG seedé. */
function seededChoices(
  correct: string,
  distractors: string[],
  rng: () => number,
): { choices: string[]; answerIndex: number } {
  const choices = seededShuffle([correct, ...distractors], rng);
  return { choices, answerIndex: choices.indexOf(correct) };
}

// ---- Matière (collectée par prepareExam, consommée purement) --------------------

export interface ExamMaterial {
  lessonId: string;
  level: number;
  /** Items SRS des mots introduits par la leçon (déjà matérialisés en base). */
  vocab: VocabItem[];
  /** Items SRS des points de grammaire de la leçon. */
  grammar: GrammarItem[];
  /** Tout le vocabulaire connu — distracteurs des QCM (un QCM tiré dans les seuls mots
   *  de la leçon se devine par élimination). */
  pool: VocabItem[];
  /** Phrases d'exemple DÉJÀ tokenisées, indexées par leur texte japonais : la
   *  tokenisation est asynchrone, elle ne peut pas vivre dans la composition pure. */
  tokenized: Map<string, KuromojiToken[]>;
  /** Texte inédit + questions, produits pour CE contrôle à partir des seuls objectifs de
   *  la leçon. Absent = section compréhension retirée (hors-ligne, Worker muet). */
  comprehension?: { text: string; questions: ComprehensionQuestion[] };
  /** Écoute impossible (réglage « sans le son » ou pause en cours) : pas de dictée. */
  silent: boolean;
}

// ---- Composition du sujet (PURE) -----------------------------------------------

const SECTION_META: Record<ExamSectionId, { title: string; instruction: string }> = {
  dictee: {
    title: "Dictée",
    instruction: "Écoute la phrase (deux écoutes au maximum), puis reconstitue-la.",
  },
  lecture: {
    title: "Lecture",
    instruction: "Écris la lecture de chaque mot en kana.",
  },
  version: {
    title: "Version",
    instruction: "Donne le sens français de chaque mot.",
  },
  theme: {
    title: "Thème",
    instruction: "Écris chaque mot en japonais.",
  },
  grammaire: {
    title: "Grammaire",
    instruction: "Réponds sur les points de grammaire de la leçon.",
  },
  comprehension: {
    title: "Compréhension",
    instruction: "Lis le texte, puis réponds aux questions.",
  },
};

/** Bornes de la phrase de dictée : en dessous rien à reconstruire, au-dessus trop long
 *  à retenir d'oreille (mêmes bornes que la dictée de révision). */
const DICTATION_MIN_TILES = 2;
const DICTATION_MAX_TILES = 8;

/** Un mot n'est interrogeable en lecture que s'il porte une graphie ≠ sa lecture. */
function hasKanjiFace(v: VocabItem): boolean {
  return faceText(v, "kanji") !== null;
}

function hasMeaning(v: VocabItem): boolean {
  return faceText(v, "fr") !== null;
}

/**
 * Distracteurs de sens français, tirés sous PRNG seedé (le `faceDistractors` de
 * exerciseBuild.ts mélange avec `shuffle`, non seedé : inutilisable dans un sujet
 * reproductible). Priorité au même niveau JLPT, jumeaux de sens exclus — un mot qui
 * porte EXACTEMENT le même sens serait une seconde bonne réponse.
 */
function meaningDistractors(
  pool: readonly VocabItem[],
  v: VocabItem,
  answer: string,
  rng: () => number,
  n: number,
): string[] {
  const seen = new Set<string>([answer]);
  const same: string[] = [];
  const other: string[] = [];
  for (const p of pool) {
    if (p.id === v.id) continue;
    const text = faceText(p, "fr");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    (p.jlpt !== undefined && p.jlpt === v.jlpt ? same : other).push(text);
  }
  return [...seededShuffle(same, rng), ...seededShuffle(other, rng)].slice(0, n);
}

/** Mots du pool dont le sens FR est indistinguable de celui de `v` (cf. frTwins). */
function frTwins(pool: readonly VocabItem[], v: VocabItem): VocabItem[] {
  const fr = faceText(v, "fr");
  if (!fr) return [];
  return pool.filter((p) => p.id !== v.id && faceText(p, "fr") === fr);
}

/** Exercice 1 — dictée : la phrase est jouée, l'élève la reconstruit par tuiles. */
function dicteeQuestion(
  m: ExamMaterial,
  pick: <T extends { id: string }>(pool: readonly T[], n: number) => T[],
): ExamQuestion | null {
  const candidates = m.vocab
    .map((v) => ({ v, ja: effectiveExample(v)?.ja }))
    .filter((c): c is { v: VocabItem; ja: string } => !!c.ja)
    .map(({ v, ja }) => ({ v, ja, tokens: m.tokenized.get(ja) }))
    .filter((c) => {
      if (!c.tokens) return false;
      const tiles = toTiles(c.tokens);
      return tiles.length >= DICTATION_MIN_TILES && tiles.length <= DICTATION_MAX_TILES;
    });
  // Le tirage passe par le picker commun : le mot dicté est « consommé » et ne sera pas
  // redemandé en lecture ou en thème deux exercices plus loin.
  const chosenWord = pick(candidates.map((c) => c.v), 1)[0];
  const chosen = candidates.find((c) => c.v.id === chosenWord?.id);
  if (!chosen) return null;
  const { v, ja, tokens } = chosen;
  const target = toTiles(tokens!);
  return {
    key: `exam-dictee:${v.id}`,
    section: "dictee",
    points: EXAM.points.dictee,
    exercise: {
      mode: "build",
      key: `exam-dictee:${v.id}`,
      track: "vocab",
      skill: "oral",
      id: v.id,
      front: "",
      prompt: "Écris la phrase entendue",
      back: target.join(" "),
      audioOnly: true,
      audio: { sentence: sentenceSpeechText(v, ja) },
      context: ja,
      target,
      tokens: tokens!,
    },
  };
}

/** Exercice 2 — lecture : graphie en kanji → lecture en kana, en SAISIE (jamais un QCM). */
function lectureQuestion(v: VocabItem): ExamQuestion {
  return {
    key: `exam-lecture:${v.id}`,
    section: "lecture",
    points: EXAM.points.lecture,
    exercise: {
      mode: "type",
      key: `exam-lecture:${v.id}`,
      track: "vocab",
      skill: "written",
      id: v.id,
      front: v.surface,
      prompt: "Écris la lecture en kana",
      back: `${v.surface}（${v.reading}）`,
      ...(hasMeaning(v) ? { meaning: v.meaning } : {}),
      word: { id: v.id, surface: v.surface, reading: v.reading },
      audioBack: { word: wordSpeechText(v.surface, v.reading) },
      answers: answerVariants(v.reading),
    },
  };
}

/** Exercice 3 — version (JA → FR) : QCM de sens, distracteurs de même niveau. */
function versionQuestion(
  v: VocabItem,
  pool: readonly VocabItem[],
  rng: () => number,
): ExamQuestion | null {
  const answer = faceText(v, "fr");
  if (!answer) return null;
  const distractors = meaningDistractors(pool, v, answer, rng, EXAM.choices - 1);
  if (distractors.length < EXAM.choices - 1) return null;
  const { choices, answerIndex } = seededChoices(answer, distractors, rng);
  return {
    key: `exam-version:${v.id}`,
    section: "version",
    points: EXAM.points.version,
    exercise: {
      mode: "choice",
      key: `exam-version:${v.id}`,
      track: "vocab",
      skill: "written",
      id: v.id,
      front: faceText(v, "kanji") ?? v.reading,
      prompt: "Que signifie ce mot ?",
      back: `${v.surface}（${v.reading}）`,
      meaning: v.meaning,
      word: { id: v.id, surface: v.surface, reading: v.reading },
      choices,
      answerIndex,
    },
  };
}

/** Exercice 4 — thème (FR → JA) : production en saisie, sans options. */
function themeQuestion(v: VocabItem, pool: readonly VocabItem[]): ExamQuestion | null {
  const fr = faceText(v, "fr");
  if (!fr) return null;
  // Les mots que ce sens désigne aussi bien sont acceptés : depuis la seule face
  // française, rien ne permet de les départager (cf. frTwins, exerciseBuild.ts).
  const twins = frTwins(pool, v);
  return {
    key: `exam-theme:${v.id}`,
    section: "theme",
    points: EXAM.points.theme,
    exercise: {
      mode: "type",
      key: `exam-theme:${v.id}`,
      track: "vocab",
      skill: "production",
      id: v.id,
      front: fr,
      prompt: "Écris ce mot en japonais",
      back: `${v.surface}（${v.reading}）`,
      meaning: v.meaning,
      word: { id: v.id, surface: v.surface, reading: v.reading },
      audioBack: { word: wordSpeechText(v.surface, v.reading) },
      answers: [
        ...new Set([
          ...answerVariants(v.surface, v.reading),
          ...answerVariants(...twins.flatMap((t) => [t.surface, t.reading])),
        ]),
      ],
    },
  };
}

/** Exercice 5a — thème guidé : la phrase d'exemple du point de grammaire, à remettre en ordre. */
function grammarBuildQuestion(
  g: GrammarItem,
  tokenized: Map<string, KuromojiToken[]>,
  points: number,
): ExamQuestion | null {
  const detail = grammarDetail(g.id);
  const ja = detail?.exampleJa;
  if (!ja) return null;
  const tokens = tokenized.get(ja);
  if (!tokens) return null;
  const target = toTiles(tokens);
  if (target.length < 2) return null;
  return {
    key: `exam-grammaire-build:${g.id}`,
    section: "grammaire",
    points,
    exercise: {
      mode: "build",
      key: `exam-grammaire-build:${g.id}`,
      track: "grammar",
      id: g.id,
      // La consigne est la traduction : on demande de PRODUIRE la phrase japonaise.
      front: detail?.exampleFr ?? g.name,
      prompt: `Compose la phrase en japonais (${g.name})`,
      back: target.join(" "),
      context: ja,
      ...(detail?.exampleFr ? { contextFr: detail.exampleFr } : {}),
      target,
      tokens,
    },
  };
}

/** Exercice 5b — la règle du point, parmi des règles voisines du curriculum. */
function grammarRuleQuestion(g: GrammarItem, rng: () => number, points: number): ExamQuestion | null {
  const detail = grammarDetail(g.id);
  const rule = g.rule || detail?.ruleFr || "";
  if (!rule) return null;
  const distractors = seededShuffle(neighborRules(g.id), rng).slice(0, EXAM.choices - 1);
  if (distractors.length < EXAM.choices - 1) return null;
  const { choices, answerIndex } = seededChoices(rule, distractors, rng);
  return {
    key: `exam-grammaire-regle:${g.id}`,
    section: "grammaire",
    points,
    exercise: {
      mode: "choice",
      key: `exam-grammaire-regle:${g.id}`,
      track: "grammar",
      id: g.id,
      front: g.name,
      prompt: "Que signifie ce point de grammaire ?",
      back: rule,
      choices,
      answerIndex,
    },
  };
}

/**
 * Exercice 5 — grammaire, DEUX questions à 2 points (le barème de la section vaut 4, quel
 * que soit le nombre de points enseignés) : chaque point de la leçon est interrogé une fois
 * — production de la phrase si le référentiel en porte une, sinon reconnaissance de la
 * règle. Une leçon à point unique reçoit la question complémentaire (la règle) plutôt
 * qu'une section à une seule question ; une leçon à trois points ou plus en échantillonne
 * deux, comme une copie qui ne peut pas tout demander.
 */
const GRAMMAR_QUESTIONS = 2;

function grammarQuestions(m: ExamMaterial, rng: () => number): ExamQuestion[] {
  const points = EXAM.points.grammaire;
  const out: ExamQuestion[] = [];
  for (const g of seededShuffle(m.grammar, rng)) {
    if (out.length >= GRAMMAR_QUESTIONS) break;
    const build = grammarBuildQuestion(g, m.tokenized, points);
    const rule = grammarRuleQuestion(g, rng, points);
    if (build) out.push(build);
    else if (rule) out.push(rule);
  }
  // Point unique : on complète par la règle pour que la section pèse son barème.
  if (out.length === 1 && m.grammar.length === 1) {
    const rule = grammarRuleQuestion(m.grammar[0], rng, points);
    if (rule && !out.some((q) => q.key === rule.key)) out.push(rule);
  }
  return out;
}

/** Exercice 6 — compréhension d'un texte inédit écrit à partir des seuls objectifs de la leçon. */
function comprehensionQuestions(m: ExamMaterial): ExamQuestion[] {
  if (!m.comprehension) return [];
  return m.comprehension.questions.slice(0, EXAM.comprehensionMax).map((q, i) => ({
    key: `exam-comprehension:${i}`,
    section: "comprehension" as const,
    points: EXAM.points.comprehension,
    exercise: {
      mode: "choice",
      key: `exam-comprehension:${i}`,
      track: "grammar",
      // Le point de grammaire visé porte la note quand le générateur l'a indiqué ; sinon
      // la question ne replanifie rien (`id` vide → `gradeExercise` créerait un item
      // fantôme, on filtre à la notation).
      id: q.targetGrammarId ?? "",
      front: "",
      prompt: q.question,
      back: q.options[q.answerIndex] ?? "",
      choices: q.options,
      answerIndex: q.answerIndex,
    },
  }));
}

function section(id: ExamSectionId, questions: ExamQuestion[], preamble?: string): ExamSection {
  return {
    id,
    title: SECTION_META[id].title,
    instruction: SECTION_META[id].instruction,
    ...(preamble ? { preamble } : {}),
    questions,
    points: questions.reduce((s, q) => s + q.points, 0),
  };
}

/**
 * Compose le sujet — fonction PURE : même matière + même tentative ⇒ même sujet.
 * Une section sans matière suffisante est retirée et son barème n'est pas compté : mieux
 * vaut un contrôle sur 17 qu'une question bâclée pour tenir un total rond.
 */
export function composeExam(m: ExamMaterial, attempt: number): Exam {
  const rng = mulberry32(hashString(`${m.lessonId}#${attempt}`));
  const pick = makePicker(rng);
  const sections: ExamSection[] = [];
  const skipped: SkippedSection[] = [];

  // 1. Dictée — écartée si l'élève ne peut pas écouter (le contrôle ne punit pas un
  // casque oublié : le barème est ramené, pas la note).
  if (m.silent) {
    skipped.push({ id: "dictee", reason: "écoute en pause (mode sans le son)" });
  } else {
    const q = dicteeQuestion(m, pick);
    if (q) sections.push(section("dictee", [q]));
    else skipped.push({ id: "dictee", reason: "aucune phrase d'exemple exploitable" });
  }

  // 2. Lecture — mots dont la graphie diffère de la lecture.
  const lecture = pick(m.vocab.filter(hasKanjiFace), EXAM.counts.lecture).map(lectureQuestion);
  if (lecture.length > 0) sections.push(section("lecture", lecture));
  else skipped.push({ id: "lecture", reason: "aucun mot en kanji dans la leçon" });

  // 3. Version (JA → FR).
  const version = pick(m.vocab.filter(hasMeaning), EXAM.counts.version)
    .map((v) => versionQuestion(v, m.pool, rng))
    .filter((q): q is ExamQuestion => q !== null);
  if (version.length > 0) sections.push(section("version", version));
  else skipped.push({ id: "version", reason: "pas assez de distracteurs plausibles" });

  // 4. Thème (FR → JA).
  const theme = pick(m.vocab.filter(hasMeaning), EXAM.counts.theme)
    .map((v) => themeQuestion(v, m.pool))
    .filter((q): q is ExamQuestion => q !== null);
  if (theme.length > 0) sections.push(section("theme", theme));
  else skipped.push({ id: "theme", reason: "aucun mot au sens exploitable" });

  // 5. Grammaire.
  const grammaire = grammarQuestions(m, rng);
  if (grammaire.length > 0) sections.push(section("grammaire", grammaire));
  else skipped.push({ id: "grammaire", reason: "la leçon n'introduit aucun point de grammaire" });

  // 6. Compréhension — la seule section qui dépend du Worker.
  const comprehension = comprehensionQuestions(m);
  if (comprehension.length > 0) {
    sections.push(section("comprehension", comprehension, m.comprehension!.text));
  } else {
    skipped.push({ id: "comprehension", reason: "texte de compréhension indisponible (hors-ligne ?)" });
  }

  // Numérotation d'une vraie copie : « Exercice 1 — Dictée », dans l'ordre du sujet.
  const numbered = sections.map((s, i) => ({ ...s, title: `Exercice ${i + 1} — ${s.title}` }));
  return {
    lessonId: m.lessonId,
    attempt,
    sections: numbered,
    maxPoints: numbered.reduce((sum, s) => sum + s.points, 0),
    skipped,
  };
}

// ---- Notation (PURE) -----------------------------------------------------------

/** Texte lisible d'une réponse donnée (copie corrigée). Vide = laissé blanc. */
function givenText(q: ExamQuestion, answer: ExamAnswer): string {
  const ex = q.exercise;
  if (answer === null || answer === undefined) return "";
  if (ex.mode === "choice") return typeof answer === "number" ? (ex.choices[answer] ?? "") : "";
  if (ex.mode === "type") return typeof answer === "string" ? answer.trim() : "";
  return Array.isArray(answer) ? answer.join(" ") : "";
}

/** Énoncé tel qu'il doit se relire dans la copie : « 今日 — Écris la lecture en kana ». */
function examPromptLabel(q: ExamQuestion): string {
  const { front, prompt } = q.exercise;
  if (front && prompt) return `${front} — ${prompt}`;
  return front || prompt || "";
}

/** Réponse attendue, en clair. */
function expectedText(q: ExamQuestion): string {
  const ex = q.exercise;
  if (ex.mode === "choice") return ex.choices[ex.answerIndex] ?? ex.back;
  if (ex.mode === "build") return ex.target.join(" ");
  return ex.back;
}

/**
 * Verdict d'une question. La saisie tolère la coquille comme un contrôle sur copie :
 * « presque » vaut la moitié des points (voir lib/typo.ts) — une lettre de travers n'est
 * pas une ignorance, mais ce n'est pas juste non plus.
 */
export function verdictFor(q: ExamQuestion, answer: ExamAnswer): ExamVerdict {
  const ex = q.exercise;
  if (answer === null || answer === undefined) return "wrong";
  if (ex.mode === "choice") return answer === ex.answerIndex ? "correct" : "wrong";
  if (ex.mode === "type") {
    if (typeof answer !== "string" || !answer.trim()) return "wrong";
    const norm = normalizeReading(toHiragana(answer.trim()));
    if (ex.answers.includes(norm)) return "correct";
    return ex.answers.some((a) => isNearMiss(norm, a)) ? "almost" : "wrong";
  }
  if (!Array.isArray(answer)) return "wrong";
  if (isCorrectOrder(answer, ex.target)) return "correct";
  // Un autre ordre grammaticalement valide vaut la totalité : la phrase EST juste.
  return isAcceptableOrder(answer, ex.tokens) ? "correct" : "wrong";
}

function pointsFor(q: ExamQuestion, verdict: ExamVerdict): number {
  if (verdict === "correct") return q.points;
  if (verdict === "almost") return q.points / 2;
  return 0;
}

/** Mention de la copie, échelle scolaire française. */
export function mentionFor(note: number): string {
  if (note >= 16) return "Très bien";
  if (note >= 14) return "Bien";
  if (note >= EXAM.passMark) return "Assez bien";
  if (note >= 10) return "Passable — rattrapage";
  return "Ajourné";
}

/** Arrondi au demi-point, comme une copie corrigée à la main. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Corrige la copie — fonction PURE, aucun effet de bord (voir `submitExam` pour l'IO). */
export function gradeExam(exam: Exam, answers: ExamAnswers): ExamResult {
  const results: QuestionResult[] = [];
  for (const s of exam.sections) {
    for (const q of s.questions) {
      const answer = answers[q.key] ?? null;
      const verdict = verdictFor(q, answer);
      results.push({
        key: q.key,
        section: q.section,
        // Énoncé de la copie : la face avant EST la question (le mot à lire, le sens à
        // traduire) ; sans elle, quatre lignes « Écris la lecture en kana » se
        // ressemblaient toutes une fois la copie relue.
        prompt: examPromptLabel(q),
        verdict,
        points: pointsFor(q, verdict),
        maxPoints: q.points,
        given: givenText(q, answer),
        expected: expectedText(q),
        itemId: q.exercise.id,
        track: q.exercise.track,
        ...(q.exercise.skill ? { skill: q.exercise.skill } : {}),
      });
    }
  }
  const obtained = results.reduce((sum, r) => sum + r.points, 0);
  const max = exam.maxPoints;
  const note = max > 0 ? roundHalf((obtained / max) * 20) : 0;
  return {
    lessonId: exam.lessonId,
    attempt: exam.attempt,
    results,
    obtained: roundHalf(obtained),
    max,
    note,
    mention: mentionFor(note),
    passed: note >= EXAM.passMark,
    sections: exam.sections.map((s) => ({
      id: s.id,
      title: s.title,
      obtained: roundHalf(
        s.questions.reduce((sum, q) => sum + (results.find((r) => r.key === q.key)?.points ?? 0), 0),
      ),
      max: s.points,
    })),
  };
}

// ---- Collecte de la matière (IO) -----------------------------------------------

/** Phrases à tokeniser pour ce sujet : exemples des mots (dictée) et des points (grammaire). */
function sentencesToTokenize(vocab: VocabItem[], grammar: GrammarItem[]): string[] {
  const out = new Set<string>();
  for (const v of vocab) {
    const ja = effectiveExample(v)?.ja;
    if (ja) out.add(ja);
  }
  for (const g of grammar) {
    const ja = grammarDetail(g.id)?.exampleJa;
    if (ja) out.add(ja);
  }
  return [...out];
}

export interface PrepareExamInput {
  lessonId: string;
  level: number;
  /** Ids `introduces` de la leçon — le sujet ne sort QUE de là. */
  vocabIds: string[];
  grammarIds: string[];
}

/**
 * Rassemble la matière puis compose le sujet. `tokenize` et `comprehension` sont injectés
 * pour garder la fonction testable sans kuromoji ni réseau ; les défauts sont les vrais.
 */
export async function prepareExam(
  input: PrepareExamInput,
  attempt: number,
  deps: {
    tokenize: (text: string) => Promise<KuromojiToken[]>;
    comprehension?: () => Promise<ExamMaterial["comprehension"]>;
    silent?: boolean;
  },
): Promise<Exam> {
  const [pool, grammarItems] = await Promise.all([
    allVocab(),
    Promise.all(input.grammarIds.map((id) => getGrammar(id))),
  ]);
  const byId = new Map(pool.map((v) => [v.id, v]));
  const vocab = input.vocabIds
    .map((id) => byId.get(id))
    .filter((v): v is VocabItem => !!v);
  const grammar = grammarItems.filter((g): g is GrammarItem => !!g);

  const tokenized = new Map<string, KuromojiToken[]>();
  await Promise.all(
    sentencesToTokenize(vocab, grammar).map(async (ja) => {
      // Tokenisation ratée (dico kuromoji absent) : la phrase est simplement écartée du
      // sujet — un contrôle sans dictée reste un contrôle.
      const tokens = await deps.tokenize(ja).catch(() => null);
      if (tokens) tokenized.set(ja, tokens);
    }),
  );

  const comprehension = deps.comprehension
    ? await deps.comprehension().catch(() => undefined)
    : undefined;

  return composeExam(
    {
      lessonId: input.lessonId,
      level: input.level,
      vocab,
      grammar,
      pool,
      tokenized,
      comprehension,
      silent: deps.silent ?? false,
    },
    attempt,
  );
}

// ---- Remise de la copie (IO) ----------------------------------------------------

/** Note SRS d'une question du contrôle : le contrôle nourrit la révision, il ne la double pas. */
function gradeOf(verdict: ExamVerdict) {
  return verdict === "correct" ? "good" : verdict === "almost" ? "hard" : "again";
}

/**
 * Corrige, enregistre la copie et replanifie les items interrogés. Une réponse fausse
 * ramène l'item dans la rotation SRS (grade « again ») : une épreuve ratée n'est pas du
 * travail perdu, c'est la révision du lendemain.
 * L'admission marque la leçon terminée et fait gagner du chemin sur la route en cours.
 */
export async function submitExam(
  exam: Exam,
  answers: ExamAnswers,
  startedAt: number,
  now: Date = new Date(),
): Promise<ExamResult> {
  const result = gradeExam(exam, answers);

  const byKey = new Map<string, ExamQuestion>();
  for (const s of exam.sections) for (const q of s.questions) byKey.set(q.key, q);

  let graded = 0;
  for (const r of result.results) {
    const q = byKey.get(r.key);
    // Question de compréhension non rattachée à un point de grammaire : rien à replanifier.
    if (!q || !r.itemId) continue;
    await gradeExercise(q.exercise, gradeOf(r.verdict), now);
    graded++;
  }
  if (graded > 0) await bumpSrsDaily(localDateString(now), { reviewed: graded });

  const record: ExamRecord = {
    id: `${exam.lessonId}#${exam.attempt}`,
    lessonId: exam.lessonId,
    attempt: exam.attempt,
    startedAt,
    submittedAt: now.getTime(),
    obtained: result.obtained,
    max: result.max,
    note: result.note,
    mention: result.mention,
    passed: result.passed,
    sections: result.sections,
    answers: result.results.map((r) => ({
      key: r.key,
      section: r.section,
      prompt: r.prompt,
      verdict: r.verdict,
      given: r.given,
      expected: r.expected,
      points: r.points,
      maxPoints: r.maxPoints,
    })),
    missed: result.results
      .filter((r) => r.verdict !== "correct" && r.itemId)
      .map((r) => ({ id: r.itemId, track: r.track, ...(r.skill ? { skill: r.skill } : {}) })),
  };
  await putExam(record);

  if (result.passed) {
    const prev = (await getLessonProgress(exam.lessonId)) ?? { id: exam.lessonId };
    await putLessonProgress({
      ...prev,
      startedAt: prev.startedAt ?? now.getTime(),
      completedAt: prev.completedAt ?? now.getTime(),
      examPassedAt: prev.examPassedAt ?? now.getTime(),
    });
    // Franchir la barrière fait avancer sur la route (même geste que le défi omikuji).
    await addTokaidoBonus(EXAM.tokaidoBonus);
  }

  return result;
}

// ---- État du contrôle d'une leçon (IO) ------------------------------------------

export interface ExamStatus {
  lessonId: string;
  /** Copies rendues, de la plus récente à la plus ancienne. */
  records: ExamRecord[];
  attempts: number;
  passed: boolean;
  /** Meilleure note obtenue (absente si aucune copie). */
  bestNote?: number;
  /** N° de la prochaine tentative (= sujet suivant). */
  nextAttempt: number;
  /** Rattrapage ouvert ? (vrai aussi tant qu'aucune copie n'a été rendue) */
  retakeReady: boolean;
  /** Items ratés pas encore repassés en révision — ce qui bloque le rattrapage. */
  pendingItems: string[];
}

/**
 * État du contrôle d'une leçon. Après un échec, le rattrapage n'est pas verrouillé par une
 * minuterie mais par le TRAVAIL : chaque item raté doit être repassé au moins une fois en
 * révision (journal `reviews`) — on ne repique pas au hasard jusqu'à tomber sur un sujet
 * facile, et le sujet du rattrapage est de toute façon un autre tirage.
 */
export async function examStatus(lessonId: string): Promise<ExamStatus> {
  const records = (await examsForLesson(lessonId)).sort((a, b) => b.attempt - a.attempt);
  const last = records[0];
  const passed = records.some((r) => r.passed);
  const base: ExamStatus = {
    lessonId,
    records,
    attempts: records.length,
    passed,
    ...(records.length ? { bestNote: Math.max(...records.map((r) => r.note)) } : {}),
    nextAttempt: (records.reduce((mx, r) => Math.max(mx, r.attempt), 0) || 0) + 1,
    retakeReady: true,
    pendingItems: [],
  };
  if (!last || passed) return base;

  const missed = [...new Set(last.missed.map((m) => m.id))];
  if (missed.length === 0) return base;
  const reviews = await allReviews();
  const reviewedSince = new Set(
    reviews.filter((r) => r.at > last.submittedAt).map((r) => r.itemId),
  );
  const pending = missed.filter((id) => !reviewedSince.has(id));
  return { ...base, retakeReady: pending.length === 0, pendingItems: pending };
}
