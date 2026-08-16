import { describe, expect, it, vi } from "vitest";
import { EXAM } from "./config";
import type { GrammarItem, VocabItem } from "./db";
import {
  composeExam,
  gradeExam,
  mentionFor,
  verdictFor,
  type ExamAnswers,
  type ExamMaterial,
  type ExamQuestion,
} from "./exam";
import type { KuromojiToken } from "./tokenizer";

// Corpus d'exemples statique neutralisé : chaque test fournit ses propres phrases.
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: () => null,
}));

function mkToken(surface_form: string, pos = "名詞"): KuromojiToken {
  return {
    surface_form,
    pos,
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: surface_form,
  };
}

function word(surface: string, reading: string, meaning: string, over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: `${surface}|${reading}`,
    surface,
    reading,
    meaning,
    tags: [],
    jlpt: 5,
    status: "review",
    cards: {},
    ...over,
  };
}

const LESSON_WORDS = [
  word("本", "ほん", "livre", { example: { ja: "今日は本を読む。", fr: "Aujourd'hui, je lis un livre." } }),
  word("猫", "ねこ", "chat"),
  word("水", "みず", "eau"),
  word("犬", "いぬ", "chien"),
  word("山", "やま", "montagne"),
  word("川", "かわ", "rivière"),
];

/** Distracteurs : des mots hors leçon, mêmes contraintes que le pool réel. */
const OTHER_WORDS = [
  word("空", "そら", "ciel"),
  word("海", "うみ", "mer"),
  word("駅", "えき", "gare"),
  word("店", "みせ", "magasin"),
  word("道", "みち", "route"),
];

const GRAMMAR: GrammarItem[] = [
  { id: "n5-wa-topic", name: "は (thème)", rule: "", examples: [], tags: [], status: "review" },
];

function material(over: Partial<ExamMaterial> = {}): ExamMaterial {
  const tokenized = new Map<string, KuromojiToken[]>([
    [
      "今日は本を読む。",
      [
        mkToken("今日"),
        mkToken("は", "助詞"),
        mkToken("本"),
        mkToken("を", "助詞"),
        mkToken("読む", "動詞"),
        mkToken("。", "記号"),
      ],
    ],
  ]);
  return {
    lessonId: "n5-01",
    level: 5,
    vocab: LESSON_WORDS,
    grammar: GRAMMAR,
    pool: [...LESSON_WORDS, ...OTHER_WORDS],
    tokenized,
    silent: false,
    ...over,
  };
}

function allQuestions(sections: { questions: ExamQuestion[] }[]): ExamQuestion[] {
  return sections.flatMap((s) => s.questions);
}

describe("composeExam — le sujet", () => {
  it("est DÉTERMINISTE : même leçon + même tentative ⇒ même sujet", () => {
    const a = composeExam(material(), 1);
    const b = composeExam(material(), 1);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("change au rattrapage : une autre tentative donne un autre tirage", () => {
    const first = composeExam(material(), 1);
    const retake = composeExam(material(), 2);
    expect(JSON.stringify(retake)).not.toBe(JSON.stringify(first));
  });

  it("numérote les exercices comme une copie", () => {
    const exam = composeExam(material(), 1);
    expect(exam.sections[0].title).toMatch(/^Exercice 1 — /);
    expect(exam.sections.at(-1)!.title).toMatch(/^Exercice \d+ — /);
  });

  it("n'interroge QUE la leçon (jamais un mot du pool hors objectifs)", () => {
    const exam = composeExam(material(), 1);
    const lessonIds = new Set(LESSON_WORDS.map((v) => v.id));
    const vocabQuestions = allQuestions(exam.sections).filter((q) => q.exercise.track === "vocab");
    expect(vocabQuestions.length).toBeGreaterThan(0);
    for (const q of vocabQuestions) expect(lessonIds).toContain(q.exercise.id);
  });

  it("évite de reposer le même mot d'un exercice à l'autre tant qu'il reste de la matière", () => {
    // 12 mots pour 11 questions de vocabulaire : chaque mot ne doit passer qu'une fois.
    const large = [
      ...LESSON_WORDS,
      word("空", "そら", "ciel"),
      word("海", "うみ", "mer"),
      word("駅", "えき", "gare"),
      word("店", "みせ", "magasin"),
      word("道", "みち", "route"),
      word("花", "はな", "fleur"),
    ];
    const exam = composeExam(material({ vocab: large, pool: large }), 1);
    const asked = allQuestions(exam.sections)
      .filter((q) => q.exercise.track === "vocab")
      .map((q) => q.exercise.id);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it("coupe les béquilles : la lecture se tape, elle ne se choisit pas", () => {
    const exam = composeExam(material(), 1);
    const lecture = exam.sections.find((s) => s.id === "lecture")!;
    for (const q of lecture.questions) expect(q.exercise.mode).toBe("type");
  });

  it("dictée : la phrase est jouée, jamais affichée", () => {
    const exam = composeExam(material(), 1);
    const dictee = exam.sections.find((s) => s.id === "dictee")!;
    const ex = dictee.questions[0].exercise;
    expect(ex.mode).toBe("build");
    expect(ex.audioOnly).toBe(true);
    expect(ex.audio?.sentence).toBeTruthy();
    expect(ex.front).toBe("");
  });

  it("tombe sur 20 quand la leçon fournit toute la matière", () => {
    const exam = composeExam(
      material({
        comprehension: {
          text: "猫は水を飲む。",
          questions: [
            { question: "Que boit le chat ?", options: ["De l'eau", "Du lait"], answerIndex: 0 },
            { question: "Qui boit ?", options: ["Le chat", "Le chien"], answerIndex: 0 },
            { question: "Où ?", options: ["Ici", "Là"], answerIndex: 0 },
          ],
        },
      }),
      1,
    );
    expect(exam.skipped).toHaveLength(0);
    expect(exam.maxPoints).toBe(20);
  });

  it("sans réseau : la compréhension saute et le barème est ramené d'autant", () => {
    const exam = composeExam(material(), 1);
    expect(exam.skipped.map((s) => s.id)).toContain("comprehension");
    expect(exam.maxPoints).toBe(20 - EXAM.points.comprehension * EXAM.comprehensionMax);
  });

  it("sans le son : pas de dictée, et le barème ne punit pas l'élève", () => {
    const exam = composeExam(material({ silent: true }), 1);
    expect(exam.sections.some((s) => s.id === "dictee")).toBe(false);
    expect(exam.skipped.find((s) => s.id === "dictee")?.reason).toMatch(/sans le son/);
    expect(exam.maxPoints).toBe(20 - EXAM.points.comprehension * EXAM.comprehensionMax - EXAM.points.dictee);
  });

  it("leçon sans grammaire : la section saute au lieu de poser une question creuse", () => {
    const exam = composeExam(material({ grammar: [] }), 1);
    expect(exam.sections.some((s) => s.id === "grammaire")).toBe(false);
    expect(exam.skipped.map((s) => s.id)).toContain("grammaire");
  });

  it("les QCM offrent quatre options, distracteurs pris hors de la leçon compris", () => {
    const exam = composeExam(material(), 1);
    for (const q of allQuestions(exam.sections)) {
      if (q.exercise.mode === "choice") expect(q.exercise.choices).toHaveLength(EXAM.choices);
    }
  });
});

describe("verdictFor — la correction", () => {
  const exam = composeExam(material(), 1);
  const typeQ = allQuestions(exam.sections).find((q) => q.exercise.mode === "type")!;
  const choiceQ = allQuestions(exam.sections).find((q) => q.exercise.mode === "choice")!;
  const buildQ = allQuestions(exam.sections).find((q) => q.exercise.mode === "build")!;

  it("saisie : la bonne réponse est juste, une coquille vaut « presque »", () => {
    if (typeQ.exercise.mode !== "type") throw new Error("fixture");
    const good = typeQ.exercise.answers[0];
    expect(verdictFor(typeQ, good)).toBe("correct");
    expect(verdictFor(typeQ, good + "か")).toBe(good.length >= 3 ? "almost" : "wrong");
    expect(verdictFor(typeQ, "まったくちがう")).toBe("wrong");
  });

  it("blanc = faux (une case vide ne se négocie pas)", () => {
    expect(verdictFor(typeQ, null)).toBe("wrong");
    expect(verdictFor(typeQ, "")).toBe("wrong");
    expect(verdictFor(choiceQ, null)).toBe("wrong");
    expect(verdictFor(buildQ, null)).toBe("wrong");
  });

  it("QCM : seule l'option attendue passe", () => {
    if (choiceQ.exercise.mode !== "choice") throw new Error("fixture");
    const { answerIndex, choices } = choiceQ.exercise;
    expect(verdictFor(choiceQ, answerIndex)).toBe("correct");
    expect(verdictFor(choiceQ, (answerIndex + 1) % choices.length)).toBe("wrong");
  });

  it("reconstruction : l'ordre du texte est juste, un ordre au hasard est faux", () => {
    if (buildQ.exercise.mode !== "build") throw new Error("fixture");
    expect(verdictFor(buildQ, [...buildQ.exercise.target])).toBe("correct");
    expect(verdictFor(buildQ, [...buildQ.exercise.target].reverse())).toBe("wrong");
  });
});

describe("gradeExam — la note", () => {
  const exam = composeExam(material(), 1);

  /** Copie parfaite : la bonne réponse pour chaque question du sujet. */
  function perfect(): ExamAnswers {
    const answers: ExamAnswers = {};
    for (const q of allQuestions(exam.sections)) {
      const ex = q.exercise;
      answers[q.key] =
        ex.mode === "choice" ? ex.answerIndex : ex.mode === "type" ? ex.answers[0] : [...ex.target];
    }
    return answers;
  }

  it("copie parfaite : 20/20, admis", () => {
    const r = gradeExam(exam, perfect());
    expect(r.obtained).toBe(exam.maxPoints);
    expect(r.note).toBe(20);
    expect(r.passed).toBe(true);
    expect(r.mention).toBe("Très bien");
  });

  it("copie blanche : 0, ajourné — et chaque question est comptée dans la copie", () => {
    const r = gradeExam(exam, {});
    expect(r.obtained).toBe(0);
    expect(r.note).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.mention).toBe("Ajourné");
    expect(r.results).toHaveLength(allQuestions(exam.sections).length);
    expect(r.results.every((q) => q.given === "")).toBe(true);
  });

  it("la note est ramenée sur 20 quel que soit le barème du sujet", () => {
    // Le sujet de la fixture n'a pas de compréhension : son barème n'est pas 20.
    expect(exam.maxPoints).not.toBe(20);
    expect(gradeExam(exam, perfect()).note).toBe(20);
  });

  it("une coquille vaut la moitié des points, pas zéro", () => {
    const typeQ = allQuestions(exam.sections).find(
      (q) => q.exercise.mode === "type" && q.exercise.answers[0].length >= 3,
    );
    if (!typeQ || typeQ.exercise.mode !== "type") return; // fixture sans réponse assez longue
    const r = gradeExam(exam, { [typeQ.key]: typeQ.exercise.answers[0] + "か" });
    const line = r.results.find((x) => x.key === typeQ.key)!;
    expect(line.verdict).toBe("almost");
    expect(line.points).toBe(typeQ.points / 2);
  });

  it("le score est aussi ventilé par exercice (comme un barème au stylo rouge)", () => {
    const r = gradeExam(exam, perfect());
    expect(r.sections.map((s) => s.id)).toEqual(exam.sections.map((s) => s.id));
    for (const s of r.sections) expect(s.obtained).toBe(s.max);
  });

  it("la copie garde la réponse donnée ET la réponse attendue", () => {
    const choiceQ = allQuestions(exam.sections).find((q) => q.exercise.mode === "choice")!;
    if (choiceQ.exercise.mode !== "choice") throw new Error("fixture");
    const wrong = (choiceQ.exercise.answerIndex + 1) % choiceQ.exercise.choices.length;
    const line = gradeExam(exam, { [choiceQ.key]: wrong }).results.find((x) => x.key === choiceQ.key)!;
    expect(line.given).toBe(choiceQ.exercise.choices[wrong]);
    expect(line.expected).toBe(choiceQ.exercise.choices[choiceQ.exercise.answerIndex]);
    // L'énoncé de la copie porte la face avant : sans elle, trois lignes « Que signifie ce
    // mot ? » seraient indiscernables une fois la copie relue.
    expect(line.prompt).toContain(choiceQ.exercise.front);
  });
});

describe("mentionFor — l'échelle", () => {
  it("suit le barème scolaire, et l'admission est à la moyenne du contrôle", () => {
    expect(mentionFor(18)).toBe("Très bien");
    expect(mentionFor(14)).toBe("Bien");
    expect(mentionFor(EXAM.passMark)).toBe("Assez bien");
    expect(mentionFor(10)).toMatch(/rattrapage/);
    expect(mentionFor(9.5)).toBe("Ajourné");
  });
});
