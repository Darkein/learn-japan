import { describe, expect, it } from "vitest";
import type { Lesson } from "./lessons";
import { splitJaSentences } from "./kana";
import {
  activeTrackIndex,
  buildComprehensionAudio,
  buildPodcastScript,
  buildVocabQuizzes,
  cleanFrench,
  COMP_PAUSE_MS,
  containsJa,
  QUIZ_PAUSE_MS,
  segmentParts,
  stripFurigana,
  titleSegment,
  trackEntries,
  type PodcastSegment,
} from "./podcastScript";

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

  it("fusionne l'amorce FR et le mot japonais en un énoncé multi-voix, blanc après le mot", () => {
    // mot 1 (compréhension) : amorce FR + mot JA lus d'une traite, puis réponse FR.
    const carrier = segs.find((s) => s.text === "Que veut dire ce mot ? みず");
    expect(carrier).toBeDefined();
    expect(carrier!.parts).toEqual([
      { lang: "fr", text: "Que veut dire ce mot ? " },
      { lang: "ja", text: "みず" },
    ]);
    expect(carrier!.pauseAfterMs).toBe(QUIZ_PAUSE_MS); // le blanc suit toujours le mot à traduire
    expect(segs.some((s) => s.text === "Cela signifie « eau ».")).toBe(true);
  });

  it("ne fusionne PAS la production FR→JP : le blanc sépare question et réponse", () => {
    // mot 0 : question FR avec blanc, PUIS réponse JA en segment distinct.
    const question = segs.find((s) => s.text.includes("« chat »"));
    expect(question!.parts).toBeUndefined();
    expect(question!.pauseAfterMs).toBe(QUIZ_PAUSE_MS);
    expect(segs.some((s) => s.lang === "ja" && s.text === "ねこ")).toBe(true);
  });

  it("insère un blanc de réponse après chaque question (un par mot)", () => {
    const questions = segs.filter((s) => s.pauseAfterMs);
    expect(questions).toHaveLength(3);
    expect(questions.every((q) => q.pauseAfterMs === QUIZ_PAUSE_MS)).toBe(true);
  });

  it("prononce toujours le yomi (jamais un kanji brut) côté japonais", () => {
    const ja = segs.flatMap((s) => segmentParts(s)).filter((p) => p.lang === "ja");
    expect(ja.map((p) => p.text)).toEqual(expect.arrayContaining(["ねこ", "みず", "いぬ"]));
  });
});

function lesson(partial: Partial<Lesson>): Lesson {
  return {
    id: "n5-01",
    order: 1,
    level: 5,
    title: "Leçon test",
    objectives: { vocab: [], grammar: [] },
    introduces: { vocab: [], grammar: [] },
    state: "ready",
    stories: [],
    ...partial,
  } as Lesson;
}

describe("buildPodcastScript", () => {
  const base = lesson({
    framing: "Para un.\n\nPara deux.",
    objectives: { vocab: [{ ja: "猫", yomi: "ねこ", fr: "chat" }], grammar: [] },
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

  it("enchaîne cours → quiz → histoire, paires JA+FR fusionnées", () => {
    const script = buildPodcastScript(base, { nextLessonTitle: "Suivante" });
    const chapters = script.map((s) => s.chapter);
    expect(chapters.indexOf("cours")).toBeLessThan(chapters.indexOf("quiz"));
    expect(chapters.indexOf("quiz")).toBeLessThan(chapters.indexOf("histoire"));

    // Dans l'histoire : la phrase JA et sa traduction FR forment UN énoncé multi-voix.
    const story = script.filter((s) => s.chapter === "histoire");
    const pair = story.find((s) => s.text === "猫がいる。 Il y a un chat.");
    expect(pair).toBeDefined();
    expect(pair!.parts).toEqual([
      { lang: "ja", text: "猫がいる。" },
      { lang: "fr", text: "Il y a un chat." },
    ]);
  });

  it("dans un bloc :::example, parle la phrase JP en voix japonaise puis sa traduction FR", () => {
    const withExample = lesson({
      ...base,
      framing: ":::example\n弁護士です。\n> Je suis avocat.\n:::",
    });
    const cours = buildPodcastScript(withExample, {}).filter((s) => s.chapter === "cours");
    // Les fences :::example / ::: ne sont jamais lues.
    expect(cours.some((s) => s.text.includes(":::"))).toBe(false);
    expect(cours[0]).toMatchObject({ lang: "ja", text: "弁護士です。" });
    // La traduction préfixée par « > » est bien prononcée (et le « > » retiré).
    expect(cours[1]).toMatchObject({ lang: "fr", text: "Je suis avocat." });
  });

  it("ne lit pas les balises structurelles (:::, ---, pipes de tableau)", () => {
    const withMarkers = lesson({
      ...base,
      framing: ":::summary\nPoint clé.\n:::\n\n---\n\n| Forme | Exemple |\n|---|---|\n| Présent | maintenant |",
    });
    const cours = buildPodcastScript(withMarkers, {}).filter((s) => s.chapter === "cours");
    expect(cours.some((s) => /:::|---|\|/.test(s.text))).toBe(false);
    expect(cours.some((s) => s.text === "Point clé.")).toBe(true);
  });

  it("fusionne une prose française à mots japonais inline en un seul énoncé multi-voix", () => {
    const withInline = lesson({
      ...base,
      framing: "La particule は marque le thème.",
    });
    const cours = buildPodcastScript(withInline, {}).filter((s) => s.chapter === "cours");
    expect(cours).toEqual([
      {
        id: expect.any(String),
        chapter: "cours",
        lang: "fr",
        text: "La particule は marque le thème.",
        parts: [
          { lang: "fr", text: "La particule " },
          { lang: "ja", text: "は " },
          { lang: "fr", text: "marque le thème." },
        ],
        label: "Cours",
      },
    ]);
  });

  it("coupe la prose fusionnée aux fins de phrase (première synthèse courte)", () => {
    const withSentences = lesson({
      ...base,
      framing: "La particule は marque le thème. Elle suit le nom です et le verbe.",
      stories: [],
    });
    const cours = buildPodcastScript(withSentences, {}).filter((s) => s.chapter === "cours");
    expect(cours.map((s) => s.text)).toEqual([
      "La particule は marque le thème.",
      "Elle suit le nom です et le verbe.",
    ]);
    // Chaque phrase reste un énoncé multi-voix (fragments FR/JA), jamais coupée en son milieu.
    expect(cours.every((s) => (s.parts?.length ?? 0) >= 2)).toBe(true);
  });

  it("prose 100 % française → segment simple, sans parts", () => {
    const pureFr = lesson({ ...base, framing: "Une phrase entièrement en français.", stories: [] });
    const cours = buildPodcastScript(pureFr, {}).filter((s) => s.chapter === "cours");
    expect(cours).toHaveLength(1);
    expect(cours[0].parts).toBeUndefined();
    expect(cours[0].text).toBe("Une phrase entièrement en français.");
  });

  it("scinde un énoncé mixte trop long aux frontières de fragments (budget SSML)", () => {
    // Chaque « phrase » FR pèse ~1 200 octets ; entrecoupée de は, l'ensemble dépasse
    // largement le budget de 4 000 octets → plusieurs segments, jamais un fragment coupé.
    const longFr = "mot ".repeat(300).trim();
    const framing = Array.from({ length: 4 }, () => `${longFr} は`).join(" ") + " fin.";
    const cours = buildPodcastScript(lesson({ ...base, framing, stories: [] }), {}).filter((s) => s.chapter === "cours");
    expect(cours.length).toBeGreaterThan(1);
    // Chaque fragment JA reste entier dans son segment.
    for (const seg of cours) {
      for (const part of segmentParts(seg)) {
        expect(part.text.trim() === "" || part.text.includes("mot") || part.text.trim() === "は" || part.text.trim() === "fin.").toBe(true);
      }
    }
    // La concaténation des segments reconstitue tout le texte (aucune perte à la scission).
    const joined = cours.map((s) => s.text).join(" ");
    expect(joined.match(/は/g)).toHaveLength(4);
  });

  it("retire le furigana entre parenthèses des exemples japonais", () => {
    const withFurigana = lesson({
      ...base,
      framing: ":::example\n弁護士（べんごし）です。\n> Je suis avocat.\n:::",
    });
    const cours = buildPodcastScript(withFurigana, {}).filter((s) => s.chapter === "cours");
    expect(cours[0]).toMatchObject({ lang: "ja", text: "弁護士です。" });
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

    // Avant le QCM : aucune traduction FR de l'histoire (passe japonais seul, segments purs).
    const before = script.slice(0, firstComp).filter((s) => s.chapter === "histoire");
    expect(before.some((s) => s.text.includes("Il y a un chat."))).toBe(false);
    expect(before.some((s) => s.lang === "ja" && s.text === "猫がいる。" && !s.parts)).toBe(true);

    // Après le QCM : la passe bilingue fusionne chaque paire JA+FR.
    const after = script.slice(lastComp + 1).filter((s) => s.chapter === "histoire");
    const pair = after.find((s) => s.text === "猫がいる。 Il y a un chat.");
    expect(pair!.parts).toEqual([
      { lang: "ja", text: "猫がいる。" },
      { lang: "fr", text: "Il y a un chat." },
    ]);
  });

  it("repli sans QCM : lecture bilingue unique (pas de chapitre compréhension)", () => {
    const noQcm = lesson({
      stories: [{ ...withQcm.stories[0], comprehension: undefined }],
    });
    const script = buildPodcastScript(noQcm, {});
    expect(script.some((s) => s.chapter === "comprehension")).toBe(false);
    const story = script.filter((s) => s.chapter === "histoire");
    expect(story.some((s) => s.text === "猫がいる。 Il y a un chat." && s.parts?.length === 2)).toBe(true);
  });
});

describe("buildPodcastScript — phrases tokenisées (karaoké)", () => {
  const story = {
    id: "s1",
    createdAt: 1,
    title: "猫の話",
    text: "猫がいる。水を飲む。",
    params: { level: 5 },
    titleFr: "Le chat",
    translation: ["Il y a un chat.", "Il boit de l'eau."],
  };
  const sentences = [
    { segments: ["猫", "が", "いる", "。"], baseIndex: 0, text: "猫がいる。" },
    { segments: ["水", "を", "飲む", "。"], baseIndex: 4, text: "水を飲む。" },
  ];
  const withTokens = lesson({ stories: [story] });

  it("aligné : phrase JA porteuse de tokens (index global) puis traduction FR séparée", () => {
    const script = buildPodcastScript(withTokens, {}, new Map([["s1", sentences]]));
    const hist = script.filter((s) => s.chapter === "histoire");
    const ja1 = hist.find((s) => s.text === "猫がいる。");
    expect(ja1).toMatchObject({ lang: "ja", tokens: ["猫", "が", "いる", "。"], baseTokenIndex: 0 });
    const ja2 = hist.find((s) => s.text === "水を飲む。");
    expect(ja2).toMatchObject({ baseTokenIndex: 4 });
    // La traduction suit en segment FR distinct, plus de paire fusionnée.
    expect(hist[hist.indexOf(ja1!) + 1]).toMatchObject({ lang: "fr", text: "Il y a un chat." });
    expect(hist.some((s) => s.parts)).toBe(false);
  });

  it("aligné : storyId posé sur tous les segments du bloc histoire (QCM compris)", () => {
    const withQcm = lesson({
      stories: [
        { ...story, comprehension: [{ question: "Qui ?", options: ["A.", "B."], answerIndex: 0 }] },
      ],
    });
    const script = buildPodcastScript(withQcm, { nextLessonTitle: "Suivante" }, new Map([["s1", sentences]]));
    for (const s of script) {
      if (s.chapter === "histoire" || s.chapter === "comprehension") {
        // Seule la transition de fin (hors histoire) reste sans storyId.
        if (s.text === "Passons à la leçon suivante :" || s.text === "Suivante") continue;
        expect(s.storyId).toBe("s1");
      } else {
        expect(s.storyId).toBeUndefined();
      }
    }
    // La passe « japonais seul » porte aussi les tokens.
    const firstComp = script.findIndex((s) => s.chapter === "comprehension");
    const before = script.slice(0, firstComp).filter((s) => s.lang === "ja");
    expect(before.every((s) => s.tokens)).toBe(true);
  });

  it("désaligné ou absent : repli sur la paire fusionnée sans tokens", () => {
    const misaligned = new Map([["s1", sentences.slice(0, 1)]]);
    for (const map of [misaligned, new Map()]) {
      const hist = buildPodcastScript(withTokens, {}, map).filter((s) => s.chapter === "histoire");
      const pair = hist.find((s) => s.text === "猫がいる。 Il y a un chat.");
      expect(pair!.parts).toHaveLength(2);
      expect(hist.some((s) => s.tokens)).toBe(false);
    }
  });
});

describe("segmentParts", () => {
  it("renvoie les parts d'un segment mixte, ou le texte entier sinon", () => {
    const mixte = { lang: "fr" as const, text: "chat 猫", parts: [{ lang: "fr" as const, text: "chat " }, { lang: "ja" as const, text: "猫" }] };
    expect(segmentParts(mixte)).toBe(mixte.parts);
    expect(segmentParts({ lang: "ja", text: "猫がいる。" })).toEqual([{ lang: "ja", text: "猫がいる。" }]);
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

describe("stripFurigana", () => {
  it("retire la lecture kana entre parenthèses après un kanji", () => {
    expect(stripFurigana("私（わたし）は学生です。")).toBe("私は学生です。");
    expect(stripFurigana("弁護士(べんごし)です。")).toBe("弁護士です。");
  });

  it("préserve les parenthèses qui ne sont pas du furigana (kanji ou latin)", () => {
    expect(stripFurigana("猫（ねこ, chat）")).toBe("猫（ねこ, chat）");
    expect(stripFurigana("東京（とうきょう）と大阪")).toBe("東京と大阪");
  });
});

describe("trackEntries / activeTrackIndex", () => {
  const seg = (id: string, chapter: PodcastSegment["chapter"], label?: string): PodcastSegment => ({
    id,
    chapter,
    lang: "fr",
    text: id,
    label,
  });
  const segments = [
    seg("s0", "cours", "Cours"),
    seg("s1", "cours"), // sans label : ignoré
    seg("s2", "quiz", "Quiz"),
    seg("s3", "quiz", "Quiz"), // même label consécutif : fusionné
    seg("s4", "histoire", "Il était une fois…"),
  ];

  it("fusionne les labels consécutifs identiques et ignore les segments sans label", () => {
    expect(trackEntries(segments).map((t) => t.i)).toEqual([0, 2, 4]);
  });

  it("ne fusionne pas un même label dans deux chapitres différents", () => {
    const s = [seg("a", "cours", "X"), seg("b", "quiz", "X")];
    expect(trackEntries(s).map((t) => t.i)).toEqual([0, 1]);
  });

  it("élément actif = dernier élément commencé avant la position courante", () => {
    const tracks = trackEntries(segments);
    expect(activeTrackIndex(tracks, 0)).toBe(0);
    expect(activeTrackIndex(tracks, 1)).toBe(0); // segment sans label : rattaché à l'élément précédent
    expect(activeTrackIndex(tracks, 3)).toBe(1); // s3 fusionné dans l'élément Quiz
    expect(activeTrackIndex(tracks, 4)).toBe(2);
    expect(activeTrackIndex([], 3)).toBe(-1);
  });
});
