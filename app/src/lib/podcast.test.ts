import { describe, expect, it } from "vitest";
import type { Lesson } from "./lessons";
import {
  buildComprehensionAudio,
  buildPodcastScript,
  buildVocabQuizzes,
  cleanFrench,
  COMP_PAUSE_MS,
  containsJa,
  QUIZ_PAUSE_MS,
  splitJaSentences,
  titleSegment,
} from "./podcast";

describe("splitJaSentences", () => {
  it("découpe sur la ponctuation finale et les sauts de ligne", () => {
    expect(splitJaSentences("猫がいる。水を飲む！\n朝だ？")).toEqual([
      "猫がいる。",
      "水を飲む！",
      "朝だ？",
    ]);
  });

  it("ignore les segments vides", () => {
    expect(splitJaSentences("\n\n猫。\n")).toEqual(["猫。"]);
  });
});

describe("buildVocabQuizzes", () => {
  const vocab = [
    { ja: "猫", yomi: "ねこ", fr: "chat" },
    { ja: "水", yomi: "みず", fr: "eau" },
    { ja: "犬", yomi: "いぬ", fr: "chien" },
  ];
  const segs = buildVocabQuizzes(vocab);

  it("alterne les directions FR↔JP pour la variété", () => {
    // mot 0 → production : question FR « Comment dit-on chat ? » puis réponse JA.
    expect(segs[0].lang).toBe("fr");
    expect(segs[0].text).toContain("chat");
  });

  it("amorce la compréhension par une phrase FR avant le mot japonais", () => {
    // mot 1 (compréhension) : amorce FR + mot JA (avec le blanc) + réponse FR.
    const carrier = segs.find((s) => s.text === "Que veut dire ce mot ?");
    expect(carrier).toBeDefined();
    expect(carrier!.lang).toBe("fr");
    const word = segs.find((s) => s.lang === "ja" && s.text === "みず");
    expect(word!.pauseAfterMs).toBe(QUIZ_PAUSE_MS); // le blanc suit le mot à traduire
  });

  it("insère un blanc de réponse après chaque question (un par mot)", () => {
    const questions = segs.filter((s) => s.pauseAfterMs);
    expect(questions).toHaveLength(3);
    expect(questions.every((q) => q.pauseAfterMs === QUIZ_PAUSE_MS)).toBe(true);
  });

  it("prononce toujours le yomi (jamais un kanji brut) côté japonais", () => {
    const ja = segs.filter((s) => s.lang === "ja");
    expect(ja.map((s) => s.text)).toEqual(expect.arrayContaining(["ねこ", "みず", "いぬ"]));
  });
});

function lesson(partial: Partial<Lesson>): Lesson {
  return {
    id: "n5-01",
    order: 1,
    level: 5,
    title: "Leçon test",
    objectives: { vocab: [], kanji: [], grammar: [] },
    introduces: { vocab: [], kanji: [], grammar: [] },
    state: "ready",
    stories: [],
    ...partial,
  } as Lesson;
}

describe("buildPodcastScript", () => {
  const base = lesson({
    framing: "Para un.\n\nPara deux.",
    objectives: { vocab: [{ ja: "猫", yomi: "ねこ", fr: "chat" }], kanji: [], grammar: [] },
    stories: [
      {
        id: "s1",
        createdAt: 1,
        title: "猫の話",
        text: "猫がいる。水を飲む。",
        params: { level: 5 },
        titleFr: "Le chat",
        translation: ["Il y a un chat.", "Il boit de l'eau."],
      },
    ],
  });

  it("enchaîne cours → quiz → histoire avec alternance JP/FR", () => {
    const script = buildPodcastScript(base, { nextLessonTitle: "Suivante" });
    const chapters = script.map((s) => s.chapter);
    expect(chapters.indexOf("cours")).toBeLessThan(chapters.indexOf("quiz"));
    expect(chapters.indexOf("quiz")).toBeLessThan(chapters.indexOf("histoire"));

    // Dans l'histoire : phrase JA suivie de sa traduction FR.
    const story = script.filter((s) => s.chapter === "histoire");
    const jaIdx = story.findIndex((s) => s.text === "猫がいる。");
    expect(story[jaIdx].lang).toBe("ja");
    expect(story[jaIdx + 1].lang).toBe("fr");
    expect(story[jaIdx + 1].text).toBe("Il y a un chat.");
  });

  it("dans le cours, parle les exemples JP en voix japonaise et saute la lecture romaji", () => {
    const withExample = lesson({
      ...base,
      framing: "La copule です marque la politesse.\n\n弁護士です。\nBengoshi desu.\nJe suis avocat.",
    });
    const cours = buildPodcastScript(withExample, {}).filter((s) => s.chapter === "cours");
    expect(cours[0]).toMatchObject({ lang: "fr", text: "La copule です marque la politesse." });
    expect(cours[1]).toMatchObject({ lang: "ja", text: "弁護士です。" });
    // La lecture romaji « Bengoshi desu. » est sautée ; reste la traduction FR.
    expect(cours.some((s) => s.text === "Bengoshi desu.")).toBe(false);
    expect(cours[2]).toMatchObject({ lang: "fr", text: "Je suis avocat." });
  });

  it("sépare la transition de fin et le titre en deux segments", () => {
    const script = buildPodcastScript(base, { nextLessonTitle: "Couleurs" });
    const transIdx = script.findIndex((s) => s.text === "Passons à la leçon suivante :");
    expect(transIdx).toBeGreaterThan(-1);
    expect(script[transIdx + 1].text).toBe("Couleurs"); // titre, segment distinct
  });

  it("boucle au début quand il n'y a pas de leçon suivante", () => {
    const script = buildPodcastScript(base, {});
    expect(script[script.length - 1].text).toBe("Recommençons depuis le début.");
  });

  it("attribue des ids uniques", () => {
    const script = buildPodcastScript(base, { nextLessonTitle: "x" });
    expect(new Set(script.map((s) => s.id)).size).toBe(script.length);
  });
});

describe("buildComprehensionAudio", () => {
  const questions = [
    { question: "Que fait le chat ?", options: ["Il dort.", "Il boit.", "Il mange.", "Il part."], answerIndex: 1 },
    { question: "Où est-il ?", options: ["Dehors.", "Dedans."], answerIndex: 0 },
  ];
  const segs = buildComprehensionAudio(questions);

  it("ouvre par une intro et énonce chaque question numérotée", () => {
    expect(segs[0]).toMatchObject({ chapter: "comprehension", lang: "fr", label: "Compréhension" });
    expect(segs.some((s) => s.text === "Question 1. Que fait le chat ?")).toBe(true);
    expect(segs.some((s) => s.text === "Question 2. Où est-il ?")).toBe(true);
  });

  it("lit les options préfixées A, B, C… et un blanc après la dernière", () => {
    expect(segs.some((s) => s.text === "A : Il dort.")).toBe(true);
    expect(segs.some((s) => s.text === "B : Il boit.")).toBe(true);
    // Le blanc de réflexion suit la dernière option (« D : Il part. »).
    const last = segs.find((s) => s.text === "D : Il part.");
    expect(last!.pauseAfterMs).toBe(COMP_PAUSE_MS);
  });

  it("annonce la bonne réponse en citant l'option correcte", () => {
    expect(segs.some((s) => s.text === "Bonne réponse : B. Il boit.")).toBe(true);
    expect(segs.some((s) => s.text === "Bonne réponse : A. Dehors.")).toBe(true);
  });

  it("est entièrement en français et ne produit rien sans question", () => {
    expect(segs.every((s) => s.lang === "fr")).toBe(true);
    expect(buildComprehensionAudio([])).toEqual([]);
  });
});

describe("buildPodcastScript — déroulé avec QCM de compréhension", () => {
  const withQcm = lesson({
    stories: [
      {
        id: "s1",
        createdAt: 1,
        title: "猫の話",
        text: "猫がいる。水を飲む。",
        params: { level: 5 },
        titleFr: "Le chat",
        translation: ["Il y a un chat.", "Il boit de l'eau."],
        comprehension: [
          { question: "Qui boit ?", options: ["Le chat.", "Le chien."], answerIndex: 0 },
        ],
      },
    ],
  });

  it("ordonne japonais seul → compréhension → bilingue", () => {
    const script = buildPodcastScript(withQcm, {});
    const firstComp = script.findIndex((s) => s.chapter === "comprehension");
    const lastComp = script.map((s) => s.chapter).lastIndexOf("comprehension");
    expect(firstComp).toBeGreaterThan(-1);

    // Avant le QCM : aucune traduction FR de l'histoire (passe japonais seul).
    const before = script.slice(0, firstComp).filter((s) => s.chapter === "histoire");
    expect(before.some((s) => s.text === "Il y a un chat.")).toBe(false);
    expect(before.some((s) => s.lang === "ja" && s.text === "猫がいる。")).toBe(true);

    // Après le QCM : la passe bilingue ré-alterne JP puis FR.
    const after = script.slice(lastComp + 1).filter((s) => s.chapter === "histoire");
    const jaIdx = after.findIndex((s) => s.text === "猫がいる。");
    expect(after[jaIdx + 1]).toMatchObject({ lang: "fr", text: "Il y a un chat." });
  });

  it("repli sans QCM : lecture bilingue unique (pas de chapitre compréhension)", () => {
    const noQcm = lesson({
      stories: [{ ...withQcm.stories[0], comprehension: undefined }],
    });
    const script = buildPodcastScript(noQcm, {});
    expect(script.some((s) => s.chapter === "comprehension")).toBe(false);
    const story = script.filter((s) => s.chapter === "histoire");
    const jaIdx = story.findIndex((s) => s.text === "猫がいる。");
    expect(story[jaIdx + 1]).toMatchObject({ lang: "fr", text: "Il y a un chat." });
  });
});

describe("titleSegment", () => {
  it("est un segment FR atomique réutilisable", () => {
    const t = titleSegment("Mon titre", "histoire");
    expect(t).toEqual({ chapter: "histoire", lang: "fr", text: "Mon titre", label: "Mon titre" });
  });
});

describe("containsJa / cleanFrench", () => {
  it("détecte le japonais (kana/kanji)", () => {
    expect(containsJa("le chat 猫")).toBe(true);
    expect(containsJa("ねこ")).toBe(true);
    expect(containsJa("le chat")).toBe(false);
  });

  it("retire les gloses japonaises entre parenthèses", () => {
    expect(cleanFrench("Le chat (猫, neko) boit de l'eau.")).toBe("Le chat boit de l'eau.");
  });

  it("retire un caractère japonais isolé et nettoie les espaces", () => {
    expect(cleanFrench("Il y a un chat 猫 .")).toBe("Il y a un chat.");
  });

  it("laisse intact un texte déjà en français pur", () => {
    expect(cleanFrench("Le matin, il a faim.")).toBe("Le matin, il a faim.");
  });
});
