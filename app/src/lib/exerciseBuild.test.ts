import { describe, expect, it, vi } from "vitest";
import { grammarLessonOrder } from "./curriculum";
import type { ComprehensionItem, GrammarItem } from "./db";
import {
  comprehensionReviewExercise,
  grammarReviewExercise,
  particleExercises,
  vocabListenMeaningExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { allGrammarInv } from "./inventory";
import type { KuromojiToken } from "./tokenizer";

// Simule le tokenizer (kuromoji ne tourne pas en node) — même approche que enroll.test.ts.
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> => {
    const mk = (surface_form: string, pos = "名詞"): KuromojiToken => ({
      surface_form,
      pos,
      pos_detail_1: "*",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "*",
      conjugated_form: "*",
      basic_form: surface_form,
    });
    if (text === "私は学生です。") {
      return [mk("私"), mk("は", "助詞"), mk("学生"), mk("です", "助動詞"), mk("。", "記号")];
    }
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
      expect(ex.target).toEqual(["私", "は", "学生", "です"]); // ponctuation exclue
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

  it("absent quand l'exemple n'a pas de traduction", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。" }), 0);
    expect(ex.contextFr).toBeUndefined();
  });
});
