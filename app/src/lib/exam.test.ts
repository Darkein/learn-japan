import { describe, expect, it, vi } from "vitest";
import { EXAM } from "./config";
import type { ExamRecord, GrammarItem, VocabItem } from "./db";
import {
  buildBulletin,
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
  word("猫", "ねこ", "chat", { example: { ja: "猫は水を飲む。", fr: "Le chat boit de l'eau." } }),
  word("水", "みず", "eau"),
  word("犬", "いぬ", "chien", { example: { ja: "犬は山を見る。", fr: "Le chien regarde la montagne." } }),
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
    [
      "猫は水を飲む。",
      [
        mkToken("猫"),
        mkToken("は", "助詞"),
        mkToken("水"),
        mkToken("を", "助詞"),
        mkToken("飲む", "動詞"),
        mkToken("。", "記号"),
      ],
    ],
    [
      "犬は山を見る。",
      [
        mkToken("犬"),
        mkToken("は", "助詞"),
        mkToken("山"),
        mkToken("を", "助詞"),
        mkToken("見る", "動詞"),
        mkToken("。", "記号"),
      ],
    ],
  ]);
  return {
    lessonId: "n5-01",
    level: 5,
    vocab: LESSON_WORDS,
    grammar: GRAMMAR,
    reviewVocab: [],
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

  it("un MOT ne passe qu'une fois dans tout le sujet", () => {
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

  it("interroge la LEÇON, pas seulement la restitution : règle, emploi et correction", () => {
    const exam = composeExam(material(), 1);
    const ids = exam.sections.map((s) => s.id);
    expect(ids).toContain("regle"); // « quel est le rôle de は ? »
    expect(ids).toContain("usage"); // « 本＿読む » : la particule à sa place
    expect(ids).toContain("correction"); // « une seule de ces phrases est correcte »
  });

  it("deux points de grammaire : la règle et l'emploi n'interrogent pas le même", () => {
    const two: GrammarItem[] = [
      ...GRAMMAR,
      { id: "n5-wo-object", name: "を (objet)", rule: "", examples: [], tags: [], status: "review" },
    ];
    const exam = composeExam(material({ grammar: two }), 1);
    const regle = exam.sections.find((s) => s.id === "regle")!.questions[0].exercise.id;
    const usage = exam.sections.find((s) => s.id === "usage")!.questions[0].exercise.id;
    expect(usage).not.toBe(regle);
  });

  it("emploi : la particule enseignée est masquée, la question a UNE seule réponse", () => {
    const exam = composeExam(material(), 1);
    const q = exam.sections.find((s) => s.id === "usage")!.questions[0];
    const ex = q.exercise;
    if (ex.mode !== "choice") throw new Error("fixture");
    expect(ex.front).toContain("＿");
    expect(ex.front).not.toContain("は");
    expect(ex.choices[ex.answerIndex]).toBe("は");
    // La traduction est donnée : sans elle, plusieurs particules répondraient.
    expect(ex.prompt).toMatch(/Complète : «/);
    // Et aucun leurre ne COMMUTE avec la réponse : は accepte が, も et を dans la même
    // phrase — les proposer, c'est poser une question à plusieurs bonnes réponses.
    for (const c of ex.choices.filter((_, i) => i !== ex.answerIndex)) {
      expect(["が", "も", "を"]).not.toContain(c);
      expect(c).not.toMatch(/です|ます|だ/);
    }
  });

  it("correction : une seule phrase juste, et les fautes sont INDISCUTABLES", () => {
    const exam = composeExam(material(), 1);
    const q = exam.sections.find((s) => s.id === "correction")!.questions[0];
    const ex = q.exercise;
    if (ex.mode !== "choice") throw new Error("fixture");
    expect(ex.choices).toHaveLength(EXAM.choices);
    const correct = ex.choices[ex.answerIndex];
    const wrong = ex.choices.filter((_, i) => i !== ex.answerIndex);
    expect(new Set(ex.choices).size).toBe(EXAM.choices);
    // Aucune faute ne se réduit à une particule SUPPRIMÉE : l'ellipse existe en japonais,
    // la compter fausse enseignerait une contre-vérité.
    for (const w of wrong) {
      expect(w).not.toBe(correct);
      expect(w.length).toBeGreaterThanOrEqual(correct.length);
    }
    // Les trois fautes ne sortent pas du même moule (sinon elles se repèrent au motif) :
    // une particule échangée, le verbe déplacé, une particule doublée.
    const doubled = wrong.filter((w) => /(.)\1/.test(w));
    expect(doubled.length).toBeLessThan(wrong.length);
  });

  it("les questions de cours (Worker) portent la section « Le cours »", () => {
    const exam = composeExam(
      material({
        lessonQcm: [
          {
            question: "Que marque la particule を ?",
            options: ["L'objet direct", "Le thème", "Le lieu", "Le moyen"],
            answerIndex: 0,
            targetGrammarId: "n5-wa-topic",
          },
          {
            question: "Pourquoi は disparaît-il parfois ?",
            options: ["Le thème est évident", "Il est interdit", "Il devient を", "Jamais"],
            answerIndex: 0,
          },
        ],
      }),
      1,
    );
    const cours = exam.sections.find((s) => s.id === "cours")!;
    expect(cours.questions).toHaveLength(2);
    expect(cours.questions[0].exercise.prompt).toContain("を");
    // Sans point de grammaire visé, la question ne replanifie aucun item SRS.
    expect(cours.questions[1].exercise.id).toBe("");
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

  /** QCM du Worker : deux questions, comme le barème le prévoit. */
  const LLM_QCM = [
    { question: "Q1 ?", options: ["a", "b", "c", "d"], answerIndex: 0 },
    { question: "Q2 ?", options: ["a", "b", "c", "d"], answerIndex: 1 },
  ];

  it("tombe sur 20 quand la leçon fournit toute la matière", () => {
    const rich = [
      ...LESSON_WORDS,
      word("空", "そら", "ciel"),
      word("海", "うみ", "mer"),
      word("駅", "えき", "gare"),
    ];
    const exam = composeExam(
      material({
        vocab: rich,
        pool: [...rich, ...OTHER_WORDS],
        comprehension: { text: "猫は水を飲む。", questions: LLM_QCM },
        lessonQcm: LLM_QCM,
      }),
      1,
    );
    expect(exam.skipped).toHaveLength(0);
    expect(exam.maxPoints).toBe(20);
  });

  it("sans réseau : cours et compréhension sautent, le barème est ramené d'autant", () => {
    const exam = composeExam(material(), 1);
    const ids = exam.skipped.map((s) => s.id);
    expect(ids).toContain("comprehension");
    expect(ids).toContain("cours");
    const llmPoints =
      EXAM.points.comprehension * EXAM.counts.comprehension + EXAM.points.cours * EXAM.counts.cours;
    expect(exam.maxPoints).toBeLessThanOrEqual(20 - llmPoints);
  });

  it("sans le son : pas de dictée, et le barème ne punit pas l'élève", () => {
    const withSound = composeExam(material(), 1);
    const silent = composeExam(material({ silent: true }), 1);
    expect(silent.sections.some((s) => s.id === "dictee")).toBe(false);
    expect(silent.skipped.find((s) => s.id === "dictee")?.reason).toMatch(/sans le son/);
    // Les points de la dictée ne sont pas comptés (le mot qu'elle aurait pris retourne aux
    // exercices écrits, d'où un total non strictement égal à l'écart des 3 points).
    expect(silent.maxPoints).toBeLessThan(withSound.maxPoints);
    for (const s of silent.sections) expect(s.id).not.toBe("dictee");
  });

  it("leçon sans grammaire : règle, emploi et correction sautent sans question creuse", () => {
    const exam = composeExam(material({ grammar: [] }), 1);
    const ids = exam.sections.map((s) => s.id);
    expect(ids).not.toContain("regle");
    expect(ids).not.toContain("usage");
    expect(exam.skipped.map((s) => s.id)).toContain("regle");
  });

  it("une PHRASE ne sert qu'à un seul exercice du sujet", () => {
    const exam = composeExam(material(), 1);
    const sentences = exam.sections
      .flatMap((s) => s.questions)
      .map((q) => q.exercise.context)
      .filter((c): c is string => !!c);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("leçon pauvre : les exercices se partagent les mots au lieu de les ressasser", () => {
    // Quatre mots comme la première leçon du curriculum : chacun ne doit passer qu'une fois,
    // et les trois exercices de vocabulaire doivent tous recevoir de la matière.
    const four = LESSON_WORDS.slice(0, 4);
    const exam = composeExam(material({ vocab: four, reviewVocab: [] }), 1);
    const vocabQuestions = exam.sections
      .flatMap((s) => s.questions)
      .filter((q) => q.exercise.track === "vocab");
    const ids = vocabQuestions.map((q) => q.exercise.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(four.length);
  });

  it("leçon pauvre : les mots déjà vus complètent le sujet plutôt que de le répéter", () => {
    const four = LESSON_WORDS.slice(0, 4);
    const withReview = composeExam(
      material({ vocab: four, reviewVocab: OTHER_WORDS, pool: [...four, ...OTHER_WORDS] }),
      1,
    );
    const withoutReview = composeExam(material({ vocab: four, reviewVocab: [] }), 1);
    const count = (e: typeof withReview) =>
      e.sections.flatMap((s) => s.questions).filter((q) => q.exercise.track === "vocab").length;
    expect(count(withReview)).toBeGreaterThan(count(withoutReview));
    // Et la leçon reste prioritaire : ses quatre mots passent tous.
    const asked = new Set(
      withReview.sections.flatMap((s) => s.questions).map((q) => q.exercise.id),
    );
    for (const v of four) expect(asked).toContain(v.id);
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

describe("buildBulletin — le relevé de notes", () => {
  function copy(lessonId: string, attempt: number, note: number, at: number): ExamRecord {
    return {
      id: `${lessonId}#${attempt}`,
      lessonId,
      attempt,
      startedAt: at - 1000,
      submittedAt: at,
      obtained: note,
      max: 20,
      note,
      mention: mentionFor(note),
      passed: note >= EXAM.passMark,
      sections: [],
      answers: [],
      missed: [],
    };
  }
  const titles: Record<string, string> = { "n5-01": "Se présenter", "n5-02": "Compter" };
  const titleOf = (id: string) => titles[id];

  it("une ligne par leçon, avec sa MEILLEURE note", () => {
    const b = buildBulletin(
      [copy("n5-01", 1, 8, 1_000), copy("n5-01", 2, 15, 2_000), copy("n5-02", 1, 13, 3_000)],
      titleOf,
    );
    expect(b.rows).toHaveLength(2);
    const first = b.rows.find((r) => r.lessonId === "n5-01")!;
    expect(first.note).toBe(15);
    expect(first.attempts).toBe(2);
    expect(first.title).toBe("Se présenter");
    expect(first.passed).toBe(true);
  });

  it("repasser un contrôle ne peut pas faire BAISSER la moyenne", () => {
    const before = buildBulletin([copy("n5-01", 1, 16, 1_000)], titleOf);
    const after = buildBulletin([copy("n5-01", 1, 16, 1_000), copy("n5-01", 2, 4, 2_000)], titleOf);
    expect(after.average).toBe(before.average);
    expect(after.rows[0].passed).toBe(true);
  });

  it("moyenne générale : chaque leçon compte pour une, au demi-point", () => {
    const b = buildBulletin([copy("n5-01", 1, 15, 1_000), copy("n5-02", 1, 12, 2_000)], titleOf);
    expect(b.average).toBe(13.5);
    expect(b.passedCount).toBe(2);
  });

  it("copies triées de la plus récente à la plus ancienne ; aucune copie ⇒ pas de moyenne", () => {
    const b = buildBulletin([copy("n5-01", 1, 15, 1_000), copy("n5-02", 1, 12, 5_000)], titleOf);
    expect(b.rows.map((r) => r.lessonId)).toEqual(["n5-02", "n5-01"]);
    expect(buildBulletin([], titleOf).average).toBeNull();
  });

  it("leçon inconnue du curriculum : son id sert de libellé (jamais de ligne vide)", () => {
    const b = buildBulletin([copy("n5-99", 1, 12, 1_000)], titleOf);
    expect(b.rows[0].title).toBe("n5-99");
  });
});
