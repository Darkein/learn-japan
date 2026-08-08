import { describe, expect, it, vi } from "vitest";
import { grammarLessonOrder } from "./curriculum";
import type { GrammarItem, VocabItem } from "./db";
import {
  grammarReviewExercise,
  vocabListenMeaningExercise,
  vocabTriangleExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { allGrammarInv, grammarDetail } from "./inventory";
import type { KuromojiToken } from "./tokenizer";
import { TYPE_STREAK } from "./vocabFaces";

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

describe("grammarReviewExercise — QCM de repli", () => {
  // Le tokenizer moqué ne rend des tuiles que pour 今日は本を読む。 : tout autre point
  // retombe sur le QCM « règle parmi des règles voisines », la branche testée ici.
  const g: GrammarItem = {
    id: "n5-wo-object",
    name: "を (objet)",
    rule: "Marque le complément d'objet direct.",
    examples: [],
    tags: [],
    status: "review",
  };

  it("la règle est la réponse, parmi des règles distinctes", async () => {
    const ex = await grammarReviewExercise(g, 0);
    expect(ex.mode).toBe("choice");
    if (ex.mode !== "choice") return;
    expect(ex.choices[ex.answerIndex]).toBe("Marque le complément d'objet direct.");
    expect(new Set(ex.choices).size).toBe(ex.choices.length);
    // Le point lui-même est la face avant (rendue en grand), la question est la consigne.
    expect(ex.front).toBe("を (objet)");
    expect(ex.prompt).toBeTruthy();
  });

  it("distracteurs tirés des points voisins dans le curriculum", async () => {
    // n5-wo-object est introduit dans les toutes premières leçons : ses voisins le sont
    // aussi. Un point tardif ne doit jamais apparaître comme distracteur.
    const order = grammarLessonOrder();
    const target = order.get(g.id)!;
    const ruleToOrder = new Map(allGrammarInv().map((x) => [x.ruleFr, order.get(x.id)]));
    for (let i = 0; i < 20; i++) {
      const ex = await grammarReviewExercise(g, 0);
      if (ex.mode !== "choice") continue;
      for (const [idx, choice] of ex.choices.entries()) {
        if (idx === ex.answerIndex) continue;
        const o = ruleToOrder.get(choice);
        expect(o).toBeDefined();
        expect(Math.abs(o! - target)).toBeLessThanOrEqual(8);
      }
    }
  });
});

function vocabItem(over: Partial<VocabItem> & { id: string }): VocabItem {
  const [surface, reading] = over.id.split("|");
  return {
    surface,
    reading,
    meaning: "—",
    tags: [],
    status: "review",
    cards: {},
    ...over,
  };
}

/** Pool de distracteurs : quatre mots complets (kanji + lecture + sens) suffisent. */
const POOL = [
  vocabItem({ id: "犬|いぬ", meaning: "chien" }),
  vocabItem({ id: "鳥|とり", meaning: "oiseau" }),
  vocabItem({ id: "本|ほん", meaning: "livre" }),
  vocabItem({ id: "水|みず", meaning: "eau" }),
  vocabItem({ id: "山|やま", meaning: "montagne" }),
];

describe("vocabTriangleExercise — directions", () => {
  const neko = () => vocabItem({ id: "猫|ねこ", meaning: "chat" });

  it("la face avant est le contenu d'une face, la réponse celui d'une autre", () => {
    const faces = new Set(["猫", "ねこ", "chat"]);
    for (let i = 0; i < 40; i++) {
      const v = neko();
      const ex = vocabTriangleExercise(v, 0, POOL);
      expect(faces).toContain(ex.front);
      const answer = ex.mode === "choice" ? ex.choices[ex.answerIndex] : null;
      if (answer) {
        expect(faces).toContain(answer);
        expect(answer).not.toBe(ex.front); // jamais une recopie
      }
    }
  });

  it("couvre les six directions d'un mot complet", () => {
    const seen = new Set<string>();
    const v = neko();
    for (let i = 0; i < 200; i++) {
      vocabTriangleExercise(v, 0, POOL);
      seen.add(v.lastDir!);
    }
    expect(seen.size).toBe(6);
  });

  it("ne rejoue jamais la direction du passage précédent", () => {
    const v = neko();
    for (let i = 0; i < 40; i++) {
      const before = v.lastDir;
      vocabTriangleExercise(v, 0, POOL);
      if (before) expect(v.lastDir).not.toBe(before);
    }
  });

  it("mot sans sens exploitable : seules les directions kanji ↔ lecture", () => {
    const v = vocabItem({ id: "猫|ねこ", meaning: "—" });
    for (let i = 0; i < 20; i++) {
      const ex = vocabTriangleExercise(v, 0, POOL);
      expect(["猫", "ねこ"]).toContain(ex.front);
    }
  });

  it("porte le mot source (correction : ruby, décomposition, mnémo)", () => {
    const ex = vocabTriangleExercise(neko(), 0, POOL);
    expect(ex.word).toEqual({ id: "猫|ねこ", surface: "猫", reading: "ねこ" });
  });
});

describe("vocabTriangleExercise — QCM ou saisie selon la maîtrise", () => {
  it("mot frais : toujours du QCM, avec 4 options distinctes dont la réponse", () => {
    for (let i = 0; i < 40; i++) {
      const ex = vocabTriangleExercise(vocabItem({ id: "猫|ねこ", meaning: "chat" }), 0, POOL);
      expect(ex.mode).toBe("choice");
      if (ex.mode === "choice") {
        expect(ex.choices).toHaveLength(4);
        expect(new Set(ex.choices).size).toBe(4);
        expect(ex.choices[ex.answerIndex]).toBeDefined();
      }
    }
  });

  it("après TYPE_STREAK réussites, la lecture se tape (les autres faces restent en QCM)", () => {
    const v = vocabItem({ id: "猫|ねこ", meaning: "chat", streak: TYPE_STREAK });
    const modes = new Map<string, string>();
    for (let i = 0; i < 200; i++) {
      const mode = vocabTriangleExercise(v, 0, POOL).mode;
      modes.set(v.lastDir!, mode); // lastDir est écrit par la construction : lire APRÈS
    }
    expect(modes.size).toBe(6);
    for (const [dir, mode] of modes) {
      expect(mode, dir).toBe(dir.endsWith(">kana") ? "type" : "choice");
    }
  });

  it("élément difficile : retour au QCM même au-dessus du seuil", () => {
    const v = vocabItem({ id: "猫|ねこ", meaning: "chat", streak: TYPE_STREAK + 5 });
    for (let i = 0; i < 40; i++) {
      expect(vocabTriangleExercise(v, 0, POOL, { isLeech: true }).mode).toBe("choice");
    }
  });

  it("pool trop pauvre pour un QCM honnête : saisie de la lecture plutôt que 2 options", () => {
    const v = vocabItem({ id: "猫|ねこ", meaning: "chat" });
    for (let i = 0; i < 20; i++) {
      const ex = vocabTriangleExercise(v, 0, [], { isLeech: false });
      expect(ex.mode).toBe("type");
      if (ex.mode === "type") expect(ex.answers).toEqual(expect.arrayContaining(["ねこ"]));
    }
  });

  it("saisie : la graphie est acceptée en plus de la lecture", () => {
    const v = vocabItem({ id: "猫|ねこ", meaning: "chat", streak: TYPE_STREAK });
    const ex = vocabTriangleExercise(v, 0, []);
    expect(ex.mode).toBe("type");
    if (ex.mode === "type") expect(ex.answers).toEqual(expect.arrayContaining(["猫", "ねこ"]));
  });
});

describe("vocabTriangleExercise — entrées du dico annotées", () => {
  it("suffixe (する) optionnel, alternatives « a; b », marqueur ～", () => {
    const cases: [Partial<VocabItem> & { id: string }, string[]][] = [
      [{ id: "勉強|べんきょう (する)", surface: "勉強", reading: "べんきょう (する)" }, ["勉強", "べんきょう", "べんきょうする"]],
      [{ id: "いい; よい|いい; よい", surface: "いい; よい", reading: "いい; よい" }, ["いい", "よい"]],
      [{ id: "～円|～えん", surface: "～円", reading: "～えん" }, ["円", "えん"]],
    ];
    for (const [over, expected] of cases) {
      const v = vocabItem({ ...over, meaning: "x", streak: TYPE_STREAK });
      const ex = vocabTriangleExercise(v, 0, []);
      expect(ex.mode).toBe("type");
      if (ex.mode === "type") expect(new Set(ex.answers)).toEqual(new Set(expected));
    }
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

describe("vocabTypeExercise — forme rencontrée (item conjugué réparé)", () => {
  // Item créé depuis します puis réparé : surface/lecture = forme de dictionnaire する,
  // l'id garde la lecture de la forme rencontrée (し), présente dans la phrase d'exemple.
  const suru = {
    id: "する|し",
    surface: "する",
    reading: "する",
    meaning: "faire",
    tags: [],
    status: "review" as const,
    cards: {},
    example: { ja: "宿題をします。", fr: "Je fais mes devoirs." },
  };

  it("produce : masque la forme rencontrée et l'accepte en réponse (avec la forme de base)", () => {
    const ex = vocabTypeExercise(suru, 0, { produce: true });
    expect(ex.front).toBe("宿題を◯◯ます。");
    expect(ex.answers).toEqual(expect.arrayContaining(["し", "する"]));
  });

  it("listen : masque la forme rencontrée et l'accepte en réponse", () => {
    const ex = vocabTypeExercise(suru, 0, { listen: true });
    expect(ex.front).toBe("宿題を◯◯ます。");
    expect(ex.prompt).toBe("Écoute et tape le mot manquant");
    expect(ex.answers).toEqual(expect.arrayContaining(["し", "する"]));
  });

  it("item curé (lecture = partie lecture de l'id) : comportement inchangé", () => {
    const neko = {
      id: "猫|ねこ", surface: "猫", reading: "ねこ", meaning: "chat",
      tags: [], status: "review" as const, cards: {},
      example: { ja: "猫が走る。" },
    };
    const ex = vocabTypeExercise(neko, 0, { produce: true });
    expect(ex.front).toBe("◯◯が走る。");
    expect(ex.answers).toEqual(["猫", "ねこ"]);
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
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, { produce: true });
    expect(ex.context).toBe("猫が走る。");
    expect(ex.contextFr).toBe("Le chat court.");
  });

  it("porte le sens FR du mot (affiché dans la correction d'un échec)", () => {
    // Face avant japonaise (écoute) comme cloze de production : le sens est nécessaire
    // dans la correction, la face avant ne le montre pas.
    expect(vocabTypeExercise(vocab({ ja: "猫が走る。" }), 0, { listen: true }).meaning).toBe("chat");
    expect(vocabTypeExercise(vocab(), 0, { produce: true }).meaning).toBe("chat");
  });

  it("variante écoute : transmet aussi contextFr", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, {
      listen: true,
    });
    expect(ex.contextFr).toBe("Le chat court.");
  });

  it("variante écoute : masque le mot cible présent dans la phrase et joue la phrase", () => {
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。", fr: "Le chat court." }), 0, {
      listen: true,
    });
    expect(ex.front).toBe("◯◯が走る。");
    expect(ex.audio).toEqual({ sentence: "猫が走る。" });
    expect(ex.context).toBe("猫が走る。");
    expect(ex.prompt).toBe("Écoute et tape le mot manquant");
  });

  it("variante écoute : mot absent de la phrase → phrase entière, consigne adaptée", () => {
    const ex = vocabTypeExercise(vocab({ ja: "動物が走る。" }), 0, { listen: true });
    expect(ex.front).toBe("動物が走る。");
    expect(ex.prompt).toBe("Écoute et tape le mot entendu");
  });

  it("variante écoute sans exemple : joue le mot seul", () => {
    const ex = vocabTypeExercise(vocab(), 0, { listen: true });
    expect(ex.front).toBe("猫");
    expect(ex.audio).toEqual({ word: "猫" });
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
    const ex = vocabTypeExercise(vocab({ ja: "猫が走る。" }), 0, { produce: true });
    expect(ex.contextFr).toBeUndefined();
  });
});
