import { describe, expect, it, vi } from "vitest";
import { grammarLessonOrder } from "./curriculum";
import type { ComprehensionItem, GrammarItem } from "./db";
import {
  comprehensionReviewExercise,
  grammarReviewExercise,
  kanjiChoiceExercises,
  kanjiReadingExercises,
  particleExercises,
  vocabListenMeaningExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { allGrammarInv, grammarDetail } from "./inventory";
import type { KuromojiToken } from "./tokenizer";

// meaningFor lit l'instantané du dico de contenu (vide en test) : on l'alimente pour les
// exercices de choix de kanji, qui exigent un sens FR.
vi.mock("./data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./data")>()),
  contentDictSnapshot: () => ({ 猫: "chat", 水: "eau", 本: "livre", 牛乳: "lait", 今日: "aujourd'hui" }),
}));

// Corpus d'exemples statique neutralisé : les tests qui veulent un exemple le passent
// explicitement — le corpus réel (examples.json) évolue via le workflow build-examples.
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: () => null,
}));

// Simule le tokenizer (kuromoji ne tourne pas en node) — même approche que enroll.test.ts.
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> => {
    const mk = (surface_form: string, pos = "名詞", reading?: string): KuromojiToken => ({
      surface_form,
      pos,
      pos_detail_1: "*",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "*",
      conjugated_form: "*",
      basic_form: surface_form,
      reading,
    });
    if (text === "今日は本を読む。") {
      return [mk("今日"), mk("は", "助詞"), mk("本"), mk("を", "助詞"), mk("読む", "動詞"), mk("。", "記号")];
    }
    // Retokenisation d'une forme de base (kanjiReadingExercises) → sa lecture.
    if (text === "飲む") return [mk("飲む", "動詞", "ノム")];
    if (text === "読む") return [mk("読む", "動詞", "ヨム")];
    return [];
  }),
}));

describe("grammarReviewExercise (remplace le mode reveal)", () => {
  it("reconstruction de phrase quand un exemple est disponible (référentiel)", async () => {
    const g: GrammarItem = {
      id: "n5-wa-topic",
      name: "は (thème)",
      rule: "",
      examples: [],
      tags: [],
      status: "review",
    };
    const ex = await grammarReviewExercise(g, 0);
    expect(ex.mode).toBe("build");
    if (ex.mode === "build") {
      expect(ex.target).toEqual(["今日", "は", "本", "を", "読む"]); // ponctuation exclue
      expect(ex.context).toBe("今日は本を読む。");
      expect(ex.contextFr).toBe("Aujourd'hui, je lis un livre.");
    }
  });

  it("tout l'inventaire N5 a une traduction FR de son exemple", () => {
    for (const g of allGrammarInv()) {
      expect(grammarDetail(g.id)?.exampleFr, g.id).toBeTruthy();
    }
  });

  it("jamais de mode reveal", async () => {
    const g: GrammarItem = {
      id: "inconnu-sans-exemple",
      name: "x",
      rule: "règle x",
      examples: [],
      tags: [],
      status: "review",
    };
    const ex = await grammarReviewExercise(g, 0);
    expect(ex.mode).not.toBe("reveal" as never);
    expect(["choice", "build", "type"]).toContain(ex.mode);
  });
});

describe("comprehensionReviewExercise (remplace le mode reveal)", () => {
  it("QCM règles voisines, jamais reveal", () => {
    const c: ComprehensionItem = {
      id: "n5-wa-topic",
      name: "は (thème)",
      rule: "Pose le décor de la phrase.",
      status: "review",
    };
    const ex = comprehensionReviewExercise(c, 0);
    expect(ex.mode).toBe("choice");
    expect(ex.choices).toContain("Pose le décor de la phrase.");
    expect(ex.choices[ex.answerIndex]).toBe("Pose le décor de la phrase.");
  });

  it("distracteurs tirés des points voisins dans le curriculum", () => {
    // n5-wa-topic est introduit à la toute première leçon : ses 8 voisins les plus
    // proches sont tous dans les ~6 premières leçons. Un point tardif (n5-soshite,
    // n5-demo — leçon 25) ne doit jamais apparaître comme distracteur.
    const order = grammarLessonOrder();
    const target = order.get("n5-wa-topic")!;
    const ruleToOrder = new Map(
      allGrammarInv().map((g) => [g.ruleFr, order.get(g.id)]),
    );
    const c: ComprehensionItem = {
      id: "n5-wa-topic",
      name: "は (thème)",
      rule: "Pose le décor de la phrase.",
      status: "review",
    };
    for (let i = 0; i < 20; i++) {
      const ex = comprehensionReviewExercise(c, 0);
      for (const [idx, choice] of ex.choices.entries()) {
        if (idx === ex.answerIndex) continue;
        const o = ruleToOrder.get(choice);
        expect(o).toBeDefined();
        expect(Math.abs(o! - target)).toBeLessThanOrEqual(6);
      }
    }
  });
});

function tok(p: Partial<KuromojiToken> & { surface_form: string; pos: string }): KuromojiToken {
  return {
    pos_detail_1: "*",
    pos_detail_2: "*",
    pos_detail_3: "*",
    conjugated_type: "*",
    conjugated_form: "*",
    basic_form: p.surface_form,
    ...p,
  };
}

describe("particleExercises", () => {
  const tokens = [
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞", pos_detail_1: "格助詞" }),
    tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    tok({ surface_form: "を", pos: "助詞", pos_detail_1: "格助詞" }),
  ];
  const exercises = particleExercises(tokens);

  it("génère un exercice choice pour chaque particule, avec 4 choix contenant la réponse", () => {
    const p = exercises.find((e) => e.cloze && e.choices[e.answerIndex] === "が");
    expect(p).toBeDefined();
    expect(p!.choices).toHaveLength(4);
    expect(p!.choices).toContain("が");
    expect(new Set(p!.choices).size).toBe(4); // pas de doublon
  });

  it("n'exige aucun input vide : chaque exercice a un answerIndex valide", () => {
    for (const e of exercises) {
      expect(e.answerIndex).toBeGreaterThanOrEqual(0);
      expect(e.choices[e.answerIndex]).toBeDefined();
    }
  });
});

describe("particleExercises — n'affiche que la phrase du trou", () => {
  const tokens = [
    tok({ surface_form: "鳥", pos: "名詞", reading: "トリ" }),
    tok({ surface_form: "は", pos: "助詞" }),
    tok({ surface_form: "いる", pos: "動詞", reading: "イル" }),
    tok({ surface_form: "。", pos: "記号" }),
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞" }),
    tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    tok({ surface_form: "を", pos: "助詞" }),
    tok({ surface_form: "飲む", pos: "動詞", reading: "ノム" }),
    tok({ surface_form: "。", pos: "記号" }),
  ];

  it("borne le cloze à la phrase courante (pas tout l'article)", () => {
    const exs = particleExercises(tokens, 8);
    const ga = exs.find((e) => e.choices[e.answerIndex] === "が" && e.cloze)!;
    // Le trou de « 猫が水を飲む。 » ne doit PAS embarquer la phrase précédente (鳥はいる。).
    expect(ga.cloze!.before).toBe("猫");
    expect(ga.cloze!.after).toBe("水を飲む。");
    expect(ga.cloze!.before).not.toContain("鳥");
  });
});

describe("kanjiReadingExercises", () => {
  const tokens = [
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞" }),
    tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    tok({ surface_form: "を", pos: "助詞" }),
    tok({ surface_form: "飲み", pos: "動詞", basic_form: "飲む", reading: "ノミ" }),
    tok({ surface_form: "ます", pos: "助動詞" }),
    tok({ surface_form: "ねこ", pos: "名詞", reading: "ネコ" }), // sans kanji → ignoré
  ];

  it("mot en kanji → saisie de la lecture en hiragana, noté sur la carte écrite", async () => {
    const exs = await kanjiReadingExercises(tokens, 10);
    const surfaces = exs.map((e) => e.front);
    expect(surfaces).toContain("水");
    expect(surfaces).not.toContain("ねこ"); // pas de kanji
    expect(surfaces).not.toContain("が"); // particule, pas un mot de contenu
    const mizu = exs.find((e) => e.front === "水")!;
    expect(mizu.mode).toBe("type");
    expect(mizu.skill).toBe("written");
    expect(mizu.answers).toEqual(["みず"]);
    expect(mizu.token).toBeDefined();
  });

  it("verbe conjugué → affiché et interrogé sous sa FORME DE BASE", async () => {
    const exs = await kanjiReadingExercises(tokens, 10);
    // 飲み (surface) doit devenir 飲む (base), avec la lecture de la base のむ (pas のみ).
    expect(exs.map((e) => e.front)).toContain("飲む");
    expect(exs.map((e) => e.front)).not.toContain("飲み");
    const nomu = exs.find((e) => e.front === "飲む")!;
    expect(nomu.answers).toEqual(["のむ"]);
    expect(nomu.back).toContain("飲む（のむ）");
  });
});

describe("kanjiChoiceExercises", () => {
  it("sens FR → choix du bon kanji, avec 3 distracteurs (pool ≥ 4 mots-kanji)", () => {
    const tokens = [
      tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
      tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
      tok({ surface_form: "本", pos: "名詞", reading: "ホン" }),
      tok({ surface_form: "牛乳", pos: "名詞", reading: "ギュウニュウ" }),
    ];
    const exs = kanjiChoiceExercises(tokens, 10);
    expect(exs.length).toBeGreaterThan(0);
    const neko = exs.find((e) => e.id.startsWith("猫"))!;
    expect(neko.front).toContain("chat");
    expect(neko.choices).toHaveLength(4);
    expect(neko.choices).toContain("猫");
    expect(neko.choices[neko.answerIndex]).toBe("猫");
    expect(new Set(neko.choices).size).toBe(4);
  });

  it("pool trop petit (< 4 mots-kanji distincts) → aucun exercice", () => {
    const tokens = [
      tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
      tok({ surface_form: "水", pos: "名詞", reading: "ミズ" }),
    ];
    expect(kanjiChoiceExercises(tokens)).toEqual([]);
  });
});

describe("particleExercises — contextFr (traduction alignée)", () => {
  const tokens = [
    tok({ surface_form: "鳥", pos: "名詞", reading: "トリ" }),
    tok({ surface_form: "は", pos: "助詞" }),
    tok({ surface_form: "いる", pos: "動詞", reading: "イル" }),
    tok({ surface_form: "。", pos: "記号" }),
    tok({ surface_form: "猫", pos: "名詞", reading: "ネコ" }),
    tok({ surface_form: "が", pos: "助詞" }),
    tok({ surface_form: "走る", pos: "動詞", reading: "ハシル" }),
    tok({ surface_form: "。", pos: "記号" }),
  ];

  it("attache la traduction de la phrase contenant le trou", () => {
    const translation = {
      ja: ["鳥はいる。", "猫が走る。"],
      fr: ["Il y a un oiseau.", "Le chat court."],
    };
    const exs = particleExercises(tokens, 8, translation);
    expect(exs.find((e) => e.front === "が")!.contextFr).toBe("Le chat court.");
    expect(exs.find((e) => e.front === "は")!.contextFr).toBe("Il y a un oiseau.");
  });

  it("omet contextFr quand la phrase ne correspond à aucune traduction", () => {
    const exs = particleExercises(tokens, 8, { ja: ["別の文。"], fr: ["Autre."] });
    for (const e of exs) expect(e.contextFr).toBeUndefined();
  });

  it("omet contextFr sans traduction fournie", () => {
    const exs = particleExercises(tokens, 8);
    for (const e of exs) expect(e.contextFr).toBeUndefined();
  });
});

describe("vocabListenMeaningExercise", () => {
  function vocab(id: string, meaning: string, example?: { ja: string }) {
    const [surface, reading] = id.split("|");
    return { id, surface, reading, meaning, tags: [], status: "review" as const, cards: {}, example };
  }
  const pool = [
    vocab("犬|いぬ", "chien"),
    vocab("鳥|とり", "oiseau"),
    vocab("本|ほん", "livre"),
    vocab("水|みず", "eau"),
  ];

  it("QCM audio-only : 4 sens dont la réponse, phrase d'exemple en audio", () => {
    const v = vocab("猫|ねこ", "chat", { ja: "猫がいる。" });
    const ex = vocabListenMeaningExercise(v, 0, pool);
    expect(ex).not.toBeNull();
    expect(ex!.audioOnly).toBe(true);
    expect(ex!.skill).toBe("oral");
    expect(ex!.audio).toEqual({ sentence: "猫がいる。" });
    expect(ex!.choices).toHaveLength(4);
    expect(ex!.choices[ex!.answerIndex]).toBe("chat");
    expect(new Set(ex!.choices).size).toBe(4);
  });

  it("null quand le pool ne fournit pas 3 distracteurs ou sans sens exploitable", () => {
    const v = vocab("猫|ねこ", "chat", { ja: "猫がいる。" });
    expect(vocabListenMeaningExercise(v, 0, pool.slice(0, 2))).toBeNull();
    expect(vocabListenMeaningExercise(vocab("猫|ねこ", "—"), 0, pool)).toBeNull();
  });
});

describe("vocabTypeExercise — production en contexte (produce)", () => {
  function vocab(example?: { ja: string; fr?: string }) {
    return {
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review" as const,
      cards: {},
      example,
    };
  }

  it("cloze ◯◯ sur la phrase d'exemple, indice FR, notée sur la compétence production", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, { produce: true });
    expect(ex.skill).toBe("production");
    expect(ex.front).toBe("◯◯が走る。");
    expect(ex.prompt).toContain("Le chat court.");
    expect(ex.answers).toEqual(expect.arrayContaining(["猫", "ねこ"]));
  });

  it("sans exemple exploitable : rappel isolé FR → mot, toujours en production", () => {
    const ex = vocabTypeExercise(vocab(), 0, { produce: true });
    expect(ex.skill).toBe("production");
    expect(ex.front).toBe("chat");
    expect(ex.key).toBe("vocab-produce:猫|ねこ");
  });
});

describe("vocabTypeExercise — contextFr", () => {
  function vocab(example?: { ja: string; fr?: string }) {
    return {
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review" as const,
      cards: {},
      example,
    };
  }

  it("transmet la traduction FR de la phrase d'exemple", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0);
    expect(ex.context).toBe("猫が走る。");
    expect(ex.contextFr).toBe("Le chat court.");
  });

  it("variante écoute : transmet aussi contextFr", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, {
      listen: true,
    });
    expect(ex.contextFr).toBe("Le chat court.");
  });

  it("variante écoute : souligne le mot cible présent dans la phrase", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, {
      listen: true,
    });
    expect(ex.underline).toBe("猫");
    expect(ex.prompt).toBe("Écoute et tape le mot souligné");
  });

  it("variante écoute : mot absent de la phrase → pas de soulignement, consigne adaptée", () => {
    const ex = vocabTypeExercise(vocab({ ja: "動物が走る。" }), 0, { listen: true });
    expect(ex.underline).toBeUndefined();
    expect(ex.prompt).toBe("Écoute et tape le mot entendu");
  });

  it("variante écoute sans le son : cloze écrit noté sur la carte orale, sans audio", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, {
      listen: true,
      silent: true,
    });
    expect(ex.skill).toBe("oral");
    expect(ex.key).toBe("vocab-listen-silent:猫|ねこ");
    expect(ex.audio).toBeUndefined();
    expect(ex.front).toBe("◯◯が走る。");
    expect(ex.answers).toEqual(expect.arrayContaining(["猫", "ねこ"]));
  });

  it("absent quand l'exemple n'a pas de traduction", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。" }), 0);
    expect(ex.contextFr).toBeUndefined();
  });
});
