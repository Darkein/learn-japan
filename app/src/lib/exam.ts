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
import { getCurriculum } from "./curriculum";
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
import { spliceAt, wholeWordIndex } from "./wordSpan";

// ---- Modèle -------------------------------------------------------------------

export type ExamSectionId =
  | "dictee"
  | "lecture"
  | "version"
  | "theme"
  /** « Quel est le rôle de を ? » — la règle enseignée, parmi des règles voisines. */
  | "regle"
  /** « 本＿読みます » — la particule à sa place : la règle EN USAGE. */
  | "usage"
  /** « Une seule de ces phrases est correcte » — la faute à repérer. */
  | "correction"
  /** QCM sur le COURS de la leçon (rôle, ellipse, pièges) — produit par le Worker. */
  | "cours"
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
  /**
   * Mots des leçons DÉJÀ vues (hors leçon courante) : ils complètent le sujet quand la
   * leçon n'a pas assez de matière pour remplir ses exercices — un contrôle scolaire
   * interroge aussi l'acquis. Jamais avant d'avoir épuisé les mots de la leçon.
   */
  reviewVocab: VocabItem[];
  /** Tout le vocabulaire connu — distracteurs des QCM (un QCM tiré dans les seuls mots
   *  de la leçon se devine par élimination). */
  pool: VocabItem[];
  /** Phrases d'exemple DÉJÀ tokenisées, indexées par leur texte japonais : la
   *  tokenisation est asynchrone, elle ne peut pas vivre dans la composition pure. */
  tokenized: Map<string, KuromojiToken[]>;
  /** Texte inédit + questions, produits pour CE contrôle à partir des seuls objectifs de
   *  la leçon. Absent = section compréhension retirée (hors-ligne, Worker muet). */
  comprehension?: { text: string; questions: ComprehensionQuestion[] };
  /** QCM sur le cours de la leçon (règles, ellipses, pièges) — même repli hors-ligne. */
  lessonQcm?: ComprehensionQuestion[];
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
  regle: {
    title: "Règle",
    instruction: "Le rôle des points de grammaire de la leçon.",
  },
  usage: {
    title: "Emploi",
    instruction: "Complète chaque phrase par la particule ou l'auxiliaire qui convient.",
  },
  correction: {
    title: "Correction",
    instruction: "Une seule phrase est correcte : repère la faute dans les autres.",
  },
  cours: {
    title: "Le cours",
    instruction: "Questions sur ce que la leçon enseigne.",
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

/** Particules candidates d'un exercice d'emploi (cloze) — distracteurs de même famille. */
const PARTICLES = ["は", "を", "が", "に", "で", "も", "と", "へ", "から", "の", "や"];
/** Auxiliaires et copules — l'autre famille : on ne mélange pas les registres dans un QCM. */
const AUXILIARIES = ["です", "だ", "ます", "ました", "ません", "でした"];

/**
 * Particules qui COMMUTENT avec une autre sans rendre la phrase fausse — elles ne peuvent
 * donc jamais être distracteurs l'une de l'autre : « 猫＿水を飲む » accepte は, が ET も, et
 * « 本＿読む » accepte を comme は (topicalisation). Un QCM à deux bonnes réponses n'est pas
 * un exercice, c'est un piège : on tire alors les leurres parmi les particules obliques
 * (に, で, と…), qui changent franchement le sens.
 */
const INTERCHANGEABLE: Record<string, string[]> = {
  は: ["が", "も", "を"],
  が: ["は", "も", "を"],
  も: ["は", "が", "を"],
  を: ["は", "も", "が"],
  に: ["へ"],
  へ: ["に"],
};

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

// ---- Répartition de la matière --------------------------------------------------

/**
 * Une phrase exploitable du sujet : le texte, sa tokenisation, sa traduction si connue, et
 * sa provenance (le mot ou le point de grammaire qui la porte). Le corpus est petit — un
 * exemple par mot, un par point de grammaire — d'où la règle : **une phrase ne sert qu'à
 * UN exercice** (dictée, emploi, correction), sinon le contrôle ressasse la même.
 */
interface ExamSentence {
  ja: string;
  fr?: string;
  tokens: KuromojiToken[];
  /** Mot dont c'est la phrase d'exemple (dictée : c'est lui qui porte la note SRS). */
  word?: VocabItem;
  /** Point de grammaire dont c'est l'exemple du référentiel. */
  grammarId?: string;
}

/** Corpus de phrases du sujet : exemples des mots de la leçon, des points de grammaire,
 *  puis des mots déjà vus — dans cet ordre de préférence. */
function sentencePool(m: ExamMaterial): ExamSentence[] {
  const out: ExamSentence[] = [];
  const seen = new Set<string>();
  const push = (ja: string | undefined, extra: Partial<ExamSentence>, fr?: string) => {
    if (!ja || seen.has(ja)) return;
    const tokens = m.tokenized.get(ja);
    if (!tokens || toTiles(tokens).length < 2) return;
    seen.add(ja);
    out.push({ ja, tokens, ...(fr ? { fr } : {}), ...extra });
  };
  for (const v of m.vocab) {
    const ex = effectiveExample(v);
    push(ex?.ja, { word: v }, ex?.fr);
  }
  for (const g of m.grammar) {
    const d = grammarDetail(g.id);
    push(d?.exampleJa, { grammarId: g.id }, d?.exampleFr);
  }
  for (const v of m.reviewVocab) {
    const ex = effectiveExample(v);
    push(ex?.ja, { word: v }, ex?.fr);
  }
  return out;
}

/**
 * Répartition des MOTS entre les exercices, en tourniquet (round-robin). Un mot ne passe
 * qu'UNE fois dans tout le sujet : quand la leçon est pauvre (la première n'a que quatre
 * mots), chaque exercice en reçoit un plutôt qu'un seul exercice les prenant tous et les
 * suivants ressassant les mêmes. Les mots de la leçon passent d'abord ; ceux des leçons
 * précédentes ne complètent que si la leçon est épuisée — un contrôle interroge d'abord
 * ce qu'il vient d'enseigner.
 */
function allocateWords(
  demands: { id: ExamSectionId; want: number; eligible: (v: VocabItem) => boolean }[],
  m: ExamMaterial,
  rng: () => number,
  /** Mots déjà consommés par un exercice de phrase (le mot dicté, par exemple). */
  reserved: Set<string> = new Set(),
): Map<ExamSectionId, VocabItem[]> {
  const out = new Map<ExamSectionId, VocabItem[]>(demands.map((d) => [d.id, []]));
  const used = new Set<string>(reserved);
  const queues = [seededShuffle(m.vocab, rng), seededShuffle(m.reviewVocab, rng)];
  for (const queue of queues) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const d of demands) {
        const got = out.get(d.id)!;
        if (got.length >= d.want) continue;
        const v = queue.find((w) => !used.has(w.id) && d.eligible(w));
        if (!v) continue;
        used.add(v.id);
        got.push(v);
        progressed = true;
      }
    }
  }
  return out;
}

/** Tirage de phrases sans remise : une phrase ne sert qu'à un exercice du sujet. */
function makeSentencePicker(pool: ExamSentence[], rng: () => number) {
  const remaining = seededShuffle(pool, rng);
  return function take(pred: (s: ExamSentence) => boolean = () => true): ExamSentence | null {
    const i = remaining.findIndex(pred);
    if (i < 0) return null;
    return remaining.splice(i, 1)[0];
  };
}

// ---- Exercices ------------------------------------------------------------------

/** Exercice 1 — dictée : la phrase est jouée, l'élève la reconstruit par tuiles. */
function dicteeQuestion(s: ExamSentence): ExamQuestion | null {
  const target = toTiles(s.tokens);
  if (target.length < DICTATION_MIN_TILES || target.length > DICTATION_MAX_TILES) return null;
  // La note va au mot dont c'est l'exemple ; à défaut (phrase du référentiel de grammaire),
  // au point de grammaire.
  const id = s.word?.id ?? s.grammarId;
  if (!id) return null;
  const track = s.word ? "vocab" : "grammar";
  return {
    key: `exam-dictee:${id}`,
    section: "dictee",
    points: EXAM.points.dictee,
    exercise: {
      mode: "build",
      key: `exam-dictee:${id}`,
      track,
      ...(s.word ? { skill: "oral" as const } : {}),
      id,
      front: "",
      prompt: "Écris la phrase entendue",
      back: target.join(" "),
      audioOnly: true,
      audio: { sentence: s.word ? sentenceSpeechText(s.word, s.ja, s.tokens) : s.ja },
      context: s.ja,
      ...(s.fr ? { contextFr: s.fr } : {}),
      target,
      tokens: s.tokens,
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

/**
 * Exercice 5 — la RÈGLE : « quel est le rôle de を ? », parmi des règles voisines du
 * curriculum. C'est la question de cours que le contrôle doit poser en premier — elle est
 * garantie dès que la leçon enseigne un point de grammaire.
 */
function regleQuestion(g: GrammarItem, rng: () => number): ExamQuestion | null {
  const detail = grammarDetail(g.id);
  const rule = g.rule || detail?.ruleFr || "";
  if (!rule) return null;
  const distractors = seededShuffle(neighborRules(g.id), rng).slice(0, EXAM.choices - 1);
  if (distractors.length < EXAM.choices - 1) return null;
  const { choices, answerIndex } = seededChoices(rule, distractors, rng);
  return {
    key: `exam-regle:${g.id}`,
    section: "regle",
    points: EXAM.points.regle,
    exercise: {
      mode: "choice",
      key: `exam-regle:${g.id}`,
      track: "grammar",
      id: g.id,
      front: detail?.name ?? g.name,
      prompt: "Quel est le rôle de ce point de grammaire ?",
      back: rule,
      choices,
      answerIndex,
    },
  };
}

/** Particule (ou auxiliaire) enseignée par un point : le kana en tête de son nom
 *  (« を (objet) » → « を », « です (copule polie) » → « です »). */
function taughtParticle(g: GrammarItem): string | null {
  const name = grammarDetail(g.id)?.name ?? g.name;
  const m = name.match(/^([ぁ-ゖ]{1,3})(?:\s|\(|（|$)/);
  const p = m?.[1];
  if (!p) return null;
  return PARTICLES.includes(p) || AUXILIARIES.includes(p) ? p : null;
}

/**
 * Exercice 6 — l'EMPLOI : la règle en situation. La particule enseignée est retirée d'une
 * phrase (« 本＿読む ») et il faut la remettre, parmi des particules de la même famille —
 * on ne mélange pas particules et copules, ce serait un QCM devinable au registre.
 * C'est la question qui vérifie qu'on a compris ce que を MARQUE, pas seulement ce qu'on
 * peut en réciter.
 */
function usageQuestion(
  g: GrammarItem,
  take: (pred?: (s: ExamSentence) => boolean) => ExamSentence | null,
  rng: () => number,
): ExamQuestion | null {
  const particle = taughtParticle(g);
  if (!particle) return null;
  // La traduction est OBLIGATOIRE : sans elle, « 猫＿水を飲む » ne dit pas si l'on veut « le
  // chat boit » ou « le chat AUSSI boit », et deux options répondraient à la question.
  const s = take((c) => !!c.fr && c.tokens.some((t) => t.surface_form === particle));
  if (!s) return null;
  const family = PARTICLES.includes(particle) ? PARTICLES : AUXILIARIES;
  const banned = new Set([particle, ...(INTERCHANGEABLE[particle] ?? [])]);
  const distractors = seededShuffle(
    family.filter((p) => !banned.has(p)),
    rng,
  ).slice(0, EXAM.choices - 1);
  if (distractors.length < EXAM.choices - 1) return null;
  const { choices, answerIndex } = seededChoices(particle, distractors, rng);
  // Une seule occurrence est masquée : masquer toutes les は d'une phrase en poserait
  // deux questions en une. Et c'est l'occurrence PARTICULE qu'on masque, pas la première
  // sous-chaîne venue : と apparaît dans ときどき avant le と de 「友達と」, et
  // 「＿きどき友達と話す」 ne demandait plus rien (cf. lib/wordSpan.ts).
  const at = wholeWordIndex(s.ja, s.tokens, particle);
  if (at < 0) return null;
  const front = spliceAt(s.ja, at, particle.length, "＿");
  return {
    key: `exam-usage:${g.id}`,
    section: "usage",
    points: EXAM.points.usage,
    exercise: {
      mode: "choice",
      key: `exam-usage:${g.id}`,
      track: "grammar",
      id: g.id,
      front,
      prompt: s.fr ? `Complète : « ${s.fr} »` : "Complète la phrase",
      back: s.ja,
      context: s.ja,
      ...(s.fr ? { contextFr: s.fr } : {}),
      choices,
      answerIndex,
    },
  };
}

/**
 * Fautes fabriquées à partir d'une phrase correcte. Seules des fautes INDISCUTABLES sont
 * produites — deux particules échangées, une particule doublée, le verbe passé en tête :
 * on n'écrit jamais un « faux » que le japonais réel tolère. En particulier, la
 * SUPPRESSION d'une particule est volontairement exclue : l'ellipse de は ou を est
 * courante à l'oral, la compter fausse enseignerait une contre-vérité (c'est justement une
 * nuance que la section « Le cours » explique).
 */
function wrongVariants(tokens: KuromojiToken[], rng: () => number): string[] {
  const surfaces = tokens.map((t) => t.surface_form);
  const partIdx = tokens.map((t, i) => (t.pos === "助詞" ? i : -1)).filter((i) => i >= 0);
  const original = surfaces.join("");

  /** Trois familles de fautes, chacune produisant ses variantes possibles. */
  const families: string[][] = [[], [], []];
  const push = (family: number, parts: string[]) => {
    const text = parts.join("");
    if (text !== original && !families[family].includes(text)) families[family].push(text);
  };

  // ① Deux particules DIFFÉRENTES échangées : 今日を本は読む。
  for (const i of partIdx) {
    for (const j of partIdx) {
      if (i >= j || surfaces[i] === surfaces[j]) continue;
      const swapped = [...surfaces];
      [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
      push(0, swapped);
    }
  }
  // ② Le GROUPE verbal final passé en tête : 読みます今日は本を。 Le groupe entier (verbe +
  // auxiliaires : 飲み + ます), sinon on déplace « ます » seul et la faute devient illisible.
  const verbStart = tokens.findIndex((t) => t.pos === "動詞" || t.pos === "形容詞");
  const tailStart = [...tokens].reverse().findIndex((t) => t.pos !== "記号");
  if (verbStart >= 0 && tailStart >= 0) {
    const end = tokens.length - tailStart; // exclusif : la ponctuation reste en place
    const moved = [...surfaces];
    const group = moved.splice(verbStart, end - verbStart);
    moved.unshift(...group);
    push(1, moved);
  }
  // ③ Une particule doublée : 本をを読む。
  for (const i of seededShuffle(partIdx, rng)) {
    const doubled = [...surfaces];
    doubled.splice(i, 0, surfaces[i]);
    push(2, doubled);
  }

  // Une faute de CHAQUE famille d'abord (tourniquet) : trois particules doublées dans les
  // mêmes options se repèrent au motif, pas à la grammaire.
  const out: string[] = [];
  for (let round = 0; out.length < 3 && round < 4; round++) {
    for (const family of families) {
      const text = family[round];
      if (text && !out.includes(text)) out.push(text);
    }
  }
  return out;
}

/**
 * Exercice 7 — la CORRECTION : quatre phrases, une seule correcte. La compétence testée
 * est celle qu'un contrôle scolaire vise avec « quelle phrase est incorrecte ? », mais
 * posée dans le sens sûr : les trois fautes sont fabriquées (voir `wrongVariants`), donc
 * connues comme fausses, là où fabriquer trois phrases justes exigerait un modèle.
 */
function correctionQuestion(
  s: ExamSentence,
  grammarId: string | undefined,
  rng: () => number,
): ExamQuestion | null {
  const id = grammarId ?? s.grammarId ?? s.word?.id;
  if (!id) return null;
  const wrong = wrongVariants(s.tokens, rng).slice(0, EXAM.choices - 1);
  if (wrong.length < EXAM.choices - 1) return null;
  const correct = s.tokens.map((t) => t.surface_form).join("");
  const { choices, answerIndex } = seededChoices(correct, wrong, rng);
  return {
    key: `exam-correction:${id}`,
    section: "correction",
    points: EXAM.points.correction,
    exercise: {
      mode: "choice",
      key: `exam-correction:${id}`,
      track: grammarId || s.grammarId ? "grammar" : "vocab",
      id,
      front: "",
      prompt: "Une seule de ces phrases est correcte. Laquelle ?",
      back: correct,
      ...(s.fr ? { contextFr: s.fr } : {}),
      choices,
      answerIndex,
    },
  };
}

/** QCM produit par le Worker (cours ou compréhension) → questions du sujet. */
function llmQuestions(
  questions: ComprehensionQuestion[],
  section: ExamSectionId,
  points: number,
  max: number,
): ExamQuestion[] {
  return questions.slice(0, max).map((q, i) => ({
    key: `exam-${section}:${i}`,
    section,
    points,
    exercise: {
      mode: "choice",
      key: `exam-${section}:${i}`,
      track: "grammar",
      // Le point de grammaire visé porte la note quand le générateur l'a indiqué ; sinon
      // la question ne replanifie rien (id vide → écarté à la notation).
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
 *
 * Deux règles gouvernent la VARIÉTÉ, parce que la matière d'une leçon est mince (la
 * première n'a que quatre mots et deux phrases d'exemple) :
 *   - un MOT ne passe qu'une fois dans tout le sujet, les exercices se les répartissant en
 *     tourniquet (`allocateWords`) ;
 *   - une PHRASE ne sert qu'à un exercice (`makeSentencePicker`).
 * Une section qui manque de matière rend moins de questions, ou disparaît — et son barème
 * n'est pas compté : mieux vaut un contrôle sur 15 que quatre fois le même mot.
 */
export function composeExam(m: ExamMaterial, attempt: number): Exam {
  const rng = mulberry32(hashString(`${m.lessonId}#${attempt}`));
  const sections: ExamSection[] = [];
  const skipped: SkippedSection[] = [];
  const take = makeSentencePicker(sentencePool(m), rng);

  // Les phrases d'abord : dictée, emploi et correction se partagent un corpus de deux ou
  // trois phrases, il ne faut pas que la dictée prenne celle dont l'emploi a besoin.
  // Les points de grammaire aussi tournent : quand la leçon en enseigne deux, la règle
  // interroge l'un et l'emploi l'autre — pas deux fois la même particule.
  const grammar = seededShuffle(m.grammar, rng);
  const regleSource = grammar;
  const usageSource = grammar.length > 1 ? [...grammar.slice(1), grammar[0]] : grammar;
  const usage = usageSource
    .map((g) => usageQuestion(g, take, rng))
    .filter((q): q is ExamQuestion => q !== null)
    .slice(0, EXAM.counts.usage);
  const correctionSentence = take((s) => wrongVariants(s.tokens, rng).length >= EXAM.choices - 1);
  // La correction porte sur le PREMIER point (celui de la règle) : avec deux points pour
  // trois exercices de grammaire, autant que les deux exercices sur phrase (emploi et
  // correction) tombent sur des points différents.
  const correction = correctionSentence
    ? correctionQuestion(correctionSentence, grammar[0]?.id, rng)
    : null;
  const dicteeSentence = m.silent
    ? null
    : take((s) => {
        const n = toTiles(s.tokens).length;
        return n >= DICTATION_MIN_TILES && n <= DICTATION_MAX_TILES;
      });
  const dictee = dicteeSentence ? dicteeQuestion(dicteeSentence) : null;

  // Puis les mots, répartis en tourniquet entre les trois exercices de vocabulaire — le
  // mot que la dictée vient de consommer n'y repasse pas.
  const words = allocateWords(
    [
      { id: "lecture", want: EXAM.counts.lecture, eligible: hasKanjiFace },
      { id: "version", want: EXAM.counts.version, eligible: hasMeaning },
      { id: "theme", want: EXAM.counts.theme, eligible: hasMeaning },
    ],
    m,
    rng,
    new Set([dicteeSentence?.word?.id].filter((id): id is string => !!id)),
  );

  // 1. Dictée — écartée si l'élève ne peut pas écouter (le contrôle ne punit pas un
  // casque oublié : le barème est ramené, pas la note).
  if (m.silent) skipped.push({ id: "dictee", reason: "écoute en pause (mode sans le son)" });
  else if (dictee) sections.push(section("dictee", [dictee]));
  else skipped.push({ id: "dictee", reason: "aucune phrase d'exemple exploitable" });

  // 2. Lecture — mots dont la graphie diffère de la lecture.
  const lecture = (words.get("lecture") ?? []).map(lectureQuestion);
  if (lecture.length > 0) sections.push(section("lecture", lecture));
  else skipped.push({ id: "lecture", reason: "aucun mot en kanji disponible" });

  // 3. Version (JA → FR).
  const version = (words.get("version") ?? [])
    .map((v) => versionQuestion(v, m.pool, rng))
    .filter((q): q is ExamQuestion => q !== null);
  if (version.length > 0) sections.push(section("version", version));
  else skipped.push({ id: "version", reason: "pas assez de mots ou de distracteurs" });

  // 4. Thème (FR → JA).
  const theme = (words.get("theme") ?? [])
    .map((v) => themeQuestion(v, m.pool))
    .filter((q): q is ExamQuestion => q !== null);
  if (theme.length > 0) sections.push(section("theme", theme));
  else skipped.push({ id: "theme", reason: "aucun mot au sens exploitable disponible" });

  // 5. Règle — garantie dès qu'un point de grammaire est enseigné.
  const regle = regleSource
    .map((g) => regleQuestion(g, rng))
    .filter((q): q is ExamQuestion => q !== null)
    .slice(0, EXAM.counts.regle);
  if (regle.length > 0) sections.push(section("regle", regle));
  else skipped.push({ id: "regle", reason: "la leçon n'introduit aucun point de grammaire" });

  // 6. Emploi — la règle en situation (cloze de particule).
  if (usage.length > 0) sections.push(section("usage", usage));
  else skipped.push({ id: "usage", reason: "aucune phrase ne porte la particule enseignée" });

  // 7. Correction — la faute à repérer.
  if (correction) sections.push(section("correction", [correction]));
  else skipped.push({ id: "correction", reason: "aucune phrase ne permet de fabriquer des fautes sûres" });

  // 8. Le cours — QCM du Worker sur ce que la leçon enseigne (rôle, ellipse, pièges).
  const cours = m.lessonQcm
    ? llmQuestions(m.lessonQcm, "cours", EXAM.points.cours, EXAM.counts.cours)
    : [];
  if (cours.length > 0) sections.push(section("cours", cours));
  else skipped.push({ id: "cours", reason: "questions de cours indisponibles (hors-ligne ?)" });

  // 9. Compréhension d'un texte inédit — l'autre section qui dépend du Worker.
  const comprehension = m.comprehension
    ? llmQuestions(
        m.comprehension.questions,
        "comprehension",
        EXAM.points.comprehension,
        EXAM.counts.comprehension,
      )
    : [];
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

/** Phrases à tokeniser pour ce sujet : exemples des mots (leçon puis révision) et des points. */
function sentencesToTokenize(
  vocab: VocabItem[],
  grammar: GrammarItem[],
  reviewVocab: VocabItem[],
): string[] {
  const out = new Set<string>();
  for (const v of [...vocab, ...reviewVocab]) {
    const ja = effectiveExample(v)?.ja;
    if (ja) out.add(ja);
  }
  for (const g of grammar) {
    const ja = grammarDetail(g.id)?.exampleJa;
    if (ja) out.add(ja);
  }
  return [...out];
}

/**
 * Mots des leçons qui PRÉCÈDENT celle-ci dans le curriculum : la réserve dans laquelle le
 * sujet puise quand la leçon courante ne suffit pas à remplir ses exercices sans reposer
 * deux fois le même mot. Plafonnée : au-delà, on tokenise des phrases pour rien.
 */
const REVIEW_POOL_MAX = 24;

function previousVocabIds(lessonId: string): string[] {
  const curriculum = getCurriculum();
  const i = curriculum.findIndex((e) => e.id === lessonId);
  if (i <= 0) return [];
  const ids = [...new Set(curriculum.slice(0, i).flatMap((e) => e.introduces.vocab))];
  // Les plus récentes d'abord : ce qu'on a vu la semaine dernière est plus légitime dans un
  // contrôle que la toute première leçon.
  return ids.reverse().slice(0, REVIEW_POOL_MAX);
}

export interface PrepareExamInput {
  lessonId: string;
  level: number;
  /** Ids `introduces` de la leçon — le cœur du sujet. */
  vocabIds: string[];
  grammarIds: string[];
}

/**
 * Rassemble la matière puis compose le sujet. `tokenize` et les générateurs LLM sont
 * injectés pour garder la fonction testable sans kuromoji ni réseau ; les défauts sont les
 * vrais. Un générateur muet (hors-ligne) retire simplement sa section du sujet.
 */
export async function prepareExam(
  input: PrepareExamInput,
  attempt: number,
  deps: {
    tokenize: (text: string) => Promise<KuromojiToken[]>;
    comprehension?: () => Promise<ExamMaterial["comprehension"]>;
    lessonQcm?: () => Promise<ExamMaterial["lessonQcm"]>;
    silent?: boolean;
  },
): Promise<Exam> {
  const [pool, grammarItems] = await Promise.all([
    allVocab(),
    Promise.all(input.grammarIds.map((id) => getGrammar(id))),
  ]);
  const byId = new Map(pool.map((v) => [v.id, v]));
  const resolve = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((v): v is VocabItem => !!v);
  const vocab = resolve(input.vocabIds);
  const lessonIds = new Set(input.vocabIds);
  const reviewVocab = resolve(previousVocabIds(input.lessonId)).filter((v) => !lessonIds.has(v.id));
  const grammar = grammarItems.filter((g): g is GrammarItem => !!g);

  const tokenized = new Map<string, KuromojiToken[]>();
  await Promise.all(
    sentencesToTokenize(vocab, grammar, reviewVocab).map(async (ja) => {
      // Tokenisation ratée (dico kuromoji absent) : la phrase est simplement écartée du
      // sujet — un contrôle sans dictée reste un contrôle.
      const tokens = await deps.tokenize(ja).catch(() => null);
      if (tokens) tokenized.set(ja, tokens);
    }),
  );

  // Les deux appels LLM partent ENSEMBLE : ils sont indépendants, et l'élève attend.
  const [comprehension, lessonQcm] = await Promise.all([
    deps.comprehension ? deps.comprehension().catch(() => undefined) : undefined,
    deps.lessonQcm ? deps.lessonQcm().catch(() => undefined) : undefined,
  ]);

  return composeExam(
    {
      lessonId: input.lessonId,
      level: input.level,
      vocab,
      grammar,
      reviewVocab,
      pool,
      tokenized,
      comprehension,
      lessonQcm,
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

// ---- Bulletin (relevé de notes) --------------------------------------------------

export interface BulletinRow {
  lessonId: string;
  title: string;
  /** Meilleure note obtenue sur la leçon (les rattrapages ne l'écrasent jamais). */
  note: number;
  mention: string;
  passed: boolean;
  attempts: number;
  /** Date de la dernière copie rendue sur cette leçon. */
  lastAt: number;
}

export interface Bulletin {
  /** Une ligne par leçon présentée, de la plus récente copie à la plus ancienne. */
  rows: BulletinRow[];
  /** Moyenne générale = moyenne des MEILLEURES notes, une leçon comptant pour une. */
  average: number | null;
  passedCount: number;
}

/**
 * Relevé de notes, façon bulletin scolaire — fonction PURE (l'appelant fournit les copies
 * et le titre de chaque leçon). Une leçon ne compte qu'UNE fois, avec sa meilleure note :
 * repasser un contrôle déjà réussi peut faire monter la moyenne, jamais la faire baisser.
 */
export function buildBulletin(
  records: ExamRecord[],
  titleOf: (lessonId: string) => string | undefined,
): Bulletin {
  const byLesson = new Map<string, ExamRecord[]>();
  for (const r of records) {
    const list = byLesson.get(r.lessonId);
    if (list) list.push(r);
    else byLesson.set(r.lessonId, [r]);
  }
  const rows: BulletinRow[] = [...byLesson.entries()].map(([lessonId, list]) => {
    const best = list.reduce((a, b) => (b.note > a.note ? b : a));
    return {
      lessonId,
      title: titleOf(lessonId) ?? lessonId,
      note: best.note,
      mention: best.mention,
      passed: list.some((r) => r.passed),
      attempts: list.length,
      lastAt: Math.max(...list.map((r) => r.submittedAt)),
    };
  });
  rows.sort((a, b) => b.lastAt - a.lastAt);
  return {
    rows,
    average: rows.length ? roundHalf(rows.reduce((s, r) => s + r.note, 0) / rows.length) : null,
    passedCount: rows.filter((r) => r.passed).length,
  };
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
