import { describe, expect, it } from "vitest";
import type { Lesson } from "./lessons";
import { splitJaSentences } from "./kana";
import { TTS_SSML_BUDGET_BYTES } from "./config";
import {
  activeTrackIndex,
  buildComprehensionAudio,
  buildPodcastScript,
  buildVocabQuizzes,
  cleanFrench,
  COMP_PAUSE_MS,
  BLOCK_PAUSE_MS,
  containsJa,
  EXAMPLE_JA_PAUSE_MS,
  EXAMPLE_PAIR_PAUSE_MS,
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
          // Citée seule, は se PRONONCE « wa » : `parts` porte le kana qui sonne juste,
          // `text` garde la graphie de la leçon (c'est lui qui sert au suivi de lecture).
          { lang: "ja", text: "わ " },
          { lang: "fr", text: "marque le thème." },
        ],
        label: "Cours",
        blockIndex: 0,
        pauseAfterMs: BLOCK_PAUSE_MS, // respiration de fin de paragraphe
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
        // は citée seule est prononcée « わ » (cf. speakCitedParticle).
        expect(part.text.trim() === "" || part.text.includes("mot") || part.text.trim() === "わ" || part.text.trim() === "fin.").toBe(true);
      }
    }
    // La concaténation des segments reconstitue tout le texte (aucune perte à la scission).
    const joined = cours.map((s) => s.text).join(" ");
    expect(joined.match(/は/g)).toHaveLength(4);
  });

  // Le chemin japonais pur n'avait AUCUN garde-fou de budget : une phrase d'exemple très
  // longue partait telle quelle, le Worker refusait le SSML, et segmentPlayer coupait toute
  // la lecture après sa relance unique.
  it("scinde aussi une ligne japonaise pure trop longue (budget SSML)", () => {
    const longJa = "これはとても長い文です。".repeat(200); // ~6 600 octets UTF-8
    const cours = buildPodcastScript(lesson({ ...base, framing: longJa, stories: [] }), {})
      .filter((s) => s.chapter === "cours");
    expect(cours.length).toBeGreaterThan(1);
    for (const seg of cours) {
      const bytes = new TextEncoder().encode(seg.text).length;
      expect(bytes).toBeLessThanOrEqual(TTS_SSML_BUDGET_BYTES);
    }
  });

  it("n'émet jamais un énoncé vide (le Worker les rejette, la lecture s'arrêterait)", () => {
    const framing = ":::info\n\n:::\n\n***\n\n| a |  |\n|---|---|\n|  |  |\n\nUn texte.";
    const script = buildPodcastScript(lesson({ ...base, framing, stories: [] }), {});
    for (const seg of script) {
      expect(segmentParts(seg).some((p) => p.text.trim() !== "")).toBe(true);
    }
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

// Le chapitre « cours » lit une leçon Markdown à voix haute. Tant qu'il se contentait d'EFFACER
// les marqueurs de structure, un tableau de conjugaison sortait en « Forme Exemple Neutre する
// Poli します », les paires d'exemples s'enchaînaient sans le moindre blanc, le résumé fusionnait
// en une phrase-fleuve, et la phrase FAUSSE d'un :::pitfall s'entendait exactement comme un bon
// exemple. Ces tests verrouillent l'interprétation de chaque bloc.
describe("coursSegments — la structure de la leçon est PARLÉE, pas effacée", () => {
  // Markdown conforme au contrat de génération (worker/src/prompts.ts) : titre, tableau de
  // conjugaison, exemples, piège, résumé à puces.
  const FRAMING = [
    "La particule は marque le thème.",
    "",
    "# Les formes de base",
    "",
    "| Forme | Exemple |",
    "|---|---|",
    "| Neutre | する |",
    "| Poli | します |",
    "",
    ":::example",
    "私は学生です。",
    "> Je suis étudiant.",
    "本を読みます。",
    "> Je lis un livre.",
    ":::",
    "",
    ":::pitfall",
    "私は日本語をできます。",
    "> On dit 日本語ができます。",
    ":::",
    "",
    ":::summary",
    "- Premier point",
    "- Second point",
    ":::",
  ].join("\n");

  const cours = (framing: string) =>
    buildPodcastScript(lesson({ framing, stories: [] }), {}).filter((s) => s.chapter === "cours");

  it("linéarise un tableau : une rangée = une phrase parlée, jamais un magma de cellules", () => {
    const texts = cours(FRAMING).map((s) => s.text);
    expect(texts).toContain("Neutre : する");
    expect(texts).toContain("Poli : します");
    // La ligne d'en-tête est de la mise en page : elle ne se prononce pas.
    expect(texts.some((t) => t.includes("Forme Exemple"))).toBe(false);
  });

  it("rappelle l'en-tête à partir de 3 colonnes (sinon on ne sait plus de quoi on parle)", () => {
    const texts = cours("| Forme | Affirmatif | Négatif |\n|---|---|---|\n| Neutre | する | しない |").map((s) => s.text);
    expect(texts).toEqual(["Neutre, Affirmatif : する, Négatif : しない"]);
  });

  it("annonce le contre-exemple d'un :::pitfall AVANT de le prononcer", () => {
    const segs = cours(FRAMING);
    const lead = segs.findIndex((s) => s.text.startsWith("On entend souvent"));
    const wrong = segs.findIndex((s) => s.text === "私は日本語をできます。");
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(lead).toBe(wrong - 1);
    // L'amorce enchaîne sur la phrase fautive : aucun blanc ne les sépare.
    expect(segs[lead].pauseAfterMs).toBeUndefined();
  });

  it("annonce le résumé et détache chaque puce (elles fusionnaient en une phrase-fleuve)", () => {
    const texts = cours(FRAMING).map((s) => s.text);
    expect(texts).toContain("Pour résumer.");
    expect(texts).toContain("Premier point");
    expect(texts).toContain("Second point");
    expect(texts.some((t) => t.includes("Premier point") && t.includes("Second point"))).toBe(false);
  });

  it("n'annonce ni :::info ni :::warning — leur contenu est vrai, la pause suffit", () => {
    const texts = cours(":::info\nUne note.\n:::").map((s) => s.text);
    expect(texts).toEqual(["Une note."]);
  });

  it("laisse respirer entre une phrase japonaise et sa traduction, puis avant l'exemple suivant", () => {
    const segs = cours(FRAMING);
    const ja = segs.find((s) => s.text === "私は学生です。")!;
    const fr = segs.find((s) => s.text === "Je suis étudiant.")!;
    expect(ja.pauseAfterMs).toBe(EXAMPLE_JA_PAUSE_MS);
    expect(fr.pauseAfterMs).toBe(EXAMPLE_PAIR_PAUSE_MS);
  });

  it("aucune frontière du cours ne reste collée : tout bloc se termine par un blanc", () => {
    const segs = cours(FRAMING);
    // Le dernier segment de chaque bloc porte une pause (les segments internes s'enchaînent).
    const lastOfBlock = segs.filter((s, i) => segs[i + 1] === undefined || segs[i + 1].blockIndex !== s.blockIndex);
    expect(lastOfBlock.length).toBeGreaterThan(1);
    expect(lastOfBlock.every((s) => (s.pauseAfterMs ?? 0) > 0)).toBe(true);
  });

  it("le titre de section devient le libellé de tracklist (le cours était un bloc monolithique)", () => {
    const segs = cours(FRAMING);
    expect(segs[0].label).toBe("Cours");
    expect(segs.some((s) => s.label === "Les formes de base")).toBe(true);
    // Une entrée de tracklist par section : la navigation suivant/précédent redevient utile.
    expect(trackEntries(segs.map((s, i) => ({ ...s, id: `x${i}` }))).length).toBeGreaterThan(1);
  });

  it("porte l'index du bloc AFFICHÉ, encadrés compris (surlignage sans recherche floue)", () => {
    const segs = cours(FRAMING);
    expect(segs.every((s) => s.blockIndex != null)).toBe(true);
    // Tous les segments d'un encadré partagent l'index de l'encadré (bloc de premier niveau).
    const summary = segs.filter((s) => s.text === "Pour résumer." || s.text === "Premier point");
    expect(new Set(summary.map((s) => s.blockIndex)).size).toBe(1);
  });

  it("recolle un paragraphe français coupé par un retour à la ligne mou", () => {
    expect(cours("Une phrase coupée\nen deux lignes.").map((s) => s.text)).toEqual(["Une phrase coupée en deux lignes."]);
  });

  it("route la voix sur le CONTENU d'une paire, pas sur le nom du champ", () => {
    // parseBlocks range en `jp` toute ligne non préfixée « > », y compris du français.
    const segs = cours(":::example\nUne ligne française.\n> Sa glose.\n:::");
    expect(segs[0].lang).toBe("fr");
  });

  // La leçon enseigne que は se prononce « wa » ; la voix japonaise, à qui on envoyait le
  // kana nu et sans contexte, disait « ha » — contredisant la phrase suivante.
  it("prononce une particule citée seule (は → wa) sans altérer le texte de la leçon", () => {
    const segs = cours("La particule は marque le thème.");
    expect(segs[0].text).toBe("La particule は marque le thème."); // graphie de la leçon, intacte
    expect(segs[0].parts).toEqual([
      { lang: "fr", text: "La particule " },
      { lang: "ja", text: "わ " },
      { lang: "fr", text: "marque le thème." },
    ]);
  });

  it("ne touche PAS à une particule en contexte (elle y est déjà bien lue)", () => {
    const segs = cours(":::example\n私は学生です。\n> Je suis étudiant.\n:::");
    expect(segmentParts(segs[0])).toEqual([{ lang: "ja", text: "私は学生です。" }]);
  });

  // Une ponctuation finale suivie d'une espace puis d'un guillemet fermant ne termine RIEN.
  // Le test naïf coupait au premier « … », donnant à la voix une intonation de fin en plein
  // milieu de la phrase, puis un segment de pure ponctuation — « ». » — que la synthèse
  // prononce « point », faute de mot où l'accrocher.
  it("ne coupe pas une citation sur ses points de suspension", () => {
    const texts = cours("は signifie « en ce qui concerne… », « quant à… ».").map((s) => s.text);
    expect(texts).toEqual(["は signifie « en ce qui concerne… », « quant à… »."]);
  });

  it("coupe toujours entre deux vraies phrases, guillemets fermants compris", () => {
    expect(cours("Il hésita… Puis il partit.").map((s) => s.text)).toEqual(["Il hésita…", "Puis il partit."]);
    expect(cours("On dit « bonjour ». Puis on entre.").map((s) => s.text)).toEqual([
      "On dit « bonjour ».",
      "Puis on entre.",
    ]);
  });

  it("ne coupe pas quand la suite n'ouvre pas une phrase (virgule, minuscule)", () => {
    expect(cours("Il dit « oui… », puis se tut.").map((s) => s.text)).toEqual(["Il dit « oui… », puis se tut."]);
  });

  it("n'émet jamais un énoncé fait de pure ponctuation (il se prononcerait « point »)", () => {
    for (const framing of ["Un texte. ». », «", "« ».", "Fin… ».", "- ».\n- Vrai point"]) {
      for (const seg of cours(framing)) {
        expect(/[\p{L}\p{N}]/u.test(seg.text)).toBe(true);
      }
    }
  });

  it("ne prononce pas une règle horizontale", () => {
    expect(cours("Avant.\n\n---\n\nAprès.").map((s) => s.text)).toEqual(["Avant.", "Après."]);
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
