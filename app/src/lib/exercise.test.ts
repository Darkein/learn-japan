import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { allReviews, getGrammar, getVocab, putVocab, _resetDbForTests } from "./db";
import { getCurriculum } from "./curriculum";
import {
  gradeExercise,
  gradeStoryExercise,
  recordLevel,
  type BuildExercise,
  type ChoiceExercise,
  type TypeExercise,
} from "./exercise";
import { newCard, review, State } from "./srs";
import type { KuromojiToken } from "./tokenizer";

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
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

describe("gradeExercise", () => {
  it("type/vocab : note la carte écrite existante", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const ex: TypeExercise = {
      mode: "type",
      key: "vocab:猫|ねこ",
      track: "vocab",
      id: "猫|ねこ",
      front: "chat",
      back: "猫（ねこ）",
      answers: ["猫", "ねこ"],
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("猫|ねこ");
    expect(v?.status).toBe("review");
    expect(v?.card?.reps).toBe(1);
  });

  it("streak : monte sur good/easy, remis à zéro sur again/hard", async () => {
    const base = {
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review" as const,
    };
    const ex: TypeExercise = {
      mode: "type",
      key: "vocab:猫|ねこ:fr>kana",
      track: "vocab",
      id: "猫|ねこ",
      front: "chat",
      back: "猫（ねこ）",
      answers: ["ねこ"],
    };

    for (const [grade, before, after] of [
      ["good", 0, 1],
      ["easy", 1, 2],
      ["again", 3, 0],
      ["hard", 3, 0],
    ] as const) {
      await putVocab({ ...base, card: newCard(new Date("2020-01-01")), streak: before });
      await gradeExercise(ex, grade, new Date());
      expect((await getVocab("猫|ねこ"))?.streak, grade).toBe(after);
    }
  });

  it("streak : toute forme d'exercice le fait avancer, tout échec le remet à zéro", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
      streak: 2,
    });
    await gradeExercise(
      {
        mode: "type",
        key: "vocab-listen:猫|ねこ",
        track: "vocab",
        skill: "oral",
        id: "猫|ねこ",
        front: "◯◯が走る。",
        back: "猫（ねこ）",
        answers: ["ねこ"],
      },
      "again",
      new Date(),
    );
    // Un mot, une carte : une écoute ratée dit que le mot n'est pas su — le compteur qui
    // ouvre la saisie repart de zéro, comme pour un échec à l'écrit.
    expect((await getVocab("猫|ねこ"))?.streak).toBe(0);
  });

  it("type/vocab en production : replanifie LA carte du mot et met à jour son statut", async () => {
    const written = newCard(new Date("2020-01-01"));
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "known",
      card: written,
    });
    const ex: TypeExercise = {
      mode: "type",
      key: "vocab-produce:猫|ねこ",
      track: "vocab",
      skill: "production",
      id: "猫|ねこ",
      front: "◯◯が走る。",
      back: "猫（ねこ）— chat",
      answers: ["猫", "ねこ"],
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("猫|ねこ");
    expect(v?.card?.reps).toBe(1);
    // « Bien » (et non « facile ») : le mot redescend de « connu » à « à revoir ».
    expect(v?.status).toBe("review");
  });

  it("une réussite ne déclare pas le mot « connu » — même notée « easy »", async () => {
    await putVocab({
      id: "猫|ねこ",
      surface: "猫",
      reading: "ねこ",
      meaning: "chat",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const ex: TypeExercise = {
      mode: "type",
      key: "vocab:猫|ねこ",
      track: "vocab",
      id: "猫|ねこ",
      front: "猫",
      back: "ねこ",
      answers: ["ねこ"],
    };
    // Aucune note ne vaut déclaration : le bouton unique de la session ne dit rien de plus
    // que « juste ». Même la note la plus haute laisse le mot « à revoir » — sinon un seul
    // passage réussi le retirerait du soulignement au lecteur et créditerait la leçon
    // d'une maîtrise jamais prouvée.
    await gradeExercise(ex, "easy", new Date());
    expect((await getVocab("猫|ねこ"))?.status).toBe("review");
  });

  it("choice/grammar : crée l'item s'il n'existe pas, avec seedName/seedRule", async () => {
    const ex: ChoiceExercise = {
      mode: "choice",
      key: "grammar:てもいい",
      track: "grammar",
      id: "てもいい",
      front: "てもいい",
      prompt: "Que signifie ce point de grammaire ?",
      back: "permission",
      seedName: "てもいい",
      seedRule: "permission",
      choices: ["permission", "obligation", "interdiction"],
      answerIndex: 0,
    };
    await gradeExercise(ex, "good", new Date());
    const g = await getGrammar("てもいい");
    expect(g?.name).toBe("てもいい");
    expect(g?.rule).toBe("permission");
    expect(g?.card?.reps).toBe(1);
  });

  it("build/vocab : note le vocabulaire de contenu de la phrase, pas la piste grammaire", async () => {
    const tokens = [
      tok({ surface_form: "猫", pos: "名詞", reading: "ネコ", basic_form: "猫" }),
      tok({ surface_form: "が", pos: "助詞" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "build:0",
      track: "vocab",
      id: "build:0",
      front: "Le chat",
      back: "猫 が",
      target: ["猫", "が"],
      tokens,
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("猫|ねこ");
    expect(v?.status).toBe("review");
    const g = await getGrammar("build:0");
    expect(g).toBeUndefined();
  });

  it("build/vocab raté : les mots de la phrase prennent « Difficile », pas un échec", async () => {
    // Un ordre faux est une erreur de syntaxe : le lexique posé dans la phrase ne doit ni
    // perdre son intervalle ni récolter le lapse qui mène au statut « difficile ».
    // Une carte déjà installée en état Review, comme un mot su de longue date.
    let written = newCard(new Date("2020-01-01"));
    for (const at of ["2020-01-02", "2020-01-10", "2020-02-01"]) {
      written = review(written, "easy", new Date(at));
    }
    expect(written.state).toBe(State.Review);
    await putVocab({
      id: "本|ほん",
      surface: "本",
      reading: "ほん",
      meaning: "livre",
      tags: [],
      status: "review",
      card: written,
    });
    const tokens = [
      tok({ surface_form: "本", pos: "名詞", reading: "ホン", basic_form: "本" }),
      tok({ surface_form: "を", pos: "助詞" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "build:0",
      track: "vocab",
      id: "build:0",
      front: "Le livre",
      back: "本 を",
      target: ["本", "を"],
      tokens,
    };
    await gradeExercise(ex, "again", new Date());
    const v = await getVocab("本|ほん");
    expect(v?.card?.lapses).toBe(0);
    expect(v?.card?.state).toBe(State.Review);
    const logged = await allReviews();
    expect(logged.map((r) => r.grade)).toEqual(["hard"]);
  });

  it("build/vocab avec skill oral (dictée) : note la carte du mot, pas ceux de la phrase", async () => {
    await putVocab({
      id: "水|みず",
      surface: "水",
      reading: "みず",
      meaning: "eau",
      tags: [],
      status: "review",
      card: newCard(new Date("2020-01-01")),
    });
    const tokens = [
      tok({ surface_form: "水", pos: "名詞", reading: "ミズ", basic_form: "水" }),
      tok({ surface_form: "を", pos: "助詞" }),
      tok({ surface_form: "飲む", pos: "動詞", reading: "ノム", basic_form: "飲む" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "vocab-dictation:水|みず",
      track: "vocab",
      skill: "oral",
      id: "水|みず",
      front: "Reconstitue la phrase entendue",
      back: "水 を 飲む",
      target: ["水", "を", "飲む"],
      tokens,
    };
    await gradeExercise(ex, "good", new Date());
    const v = await getVocab("水|みず");
    expect(v?.card?.reps).toBe(1);
    // Le token 飲む n'a PAS été noté individuellement (pas de per-token applyStatus).
    expect(await getVocab("飲む|のむ")).toBeUndefined();
  });

  it("build/grammar : note la carte grammaire, pas le vocabulaire des tokens", async () => {
    const ex: BuildExercise = {
      mode: "build",
      key: "grammar:てもいい",
      track: "grammar",
      id: "てもいい",
      front: "てもいい",
      back: "permission",
      seedName: "てもいい",
      seedRule: "permission",
      target: ["猫", "は", "寝", "てもいい"],
      tokens: [],
    };
    await gradeExercise(ex, "good", new Date());
    const g = await getGrammar("てもいい");
    expect(g?.card?.reps).toBe(1);
    const v = await getVocab("猫|ねこ");
    expect(v).toBeUndefined();
  });
});

describe("gradeStoryExercise (exercices d'une histoire)", () => {
  // Un objectif de la première leçon, et un mot qu'aucune leçon n'enseigne.
  const objective = getCurriculum()[0].introduces.vocab[0];
  const [objSurface, objReading] = objective.split("|");
  const incidental = "宝物|ほうもつ";

  function typeEx(id: string): TypeExercise {
    const [surface, reading] = id.split("|");
    return { mode: "type", key: `vocab:${id}`, track: "vocab", id, front: surface, back: reading, answers: [reading] };
  }

  it("note un objectif de leçon qui a déjà une carte", async () => {
    await putVocab({ id: objective, surface: objSurface, reading: objReading, meaning: "x", tags: [], status: "review", card: newCard(new Date("2026-01-01")) });
    await gradeStoryExercise(typeEx(objective), "good", new Date("2026-01-02"));
    expect((await getVocab(objective))?.card?.reps).toBe(1);
  });

  it("ne crée aucune carte : un objectif sans carte reste sans carte", async () => {
    await putVocab({ id: objective, surface: objSurface, reading: objReading, meaning: "x", tags: [], status: "unknown" });
    await gradeStoryExercise(typeEx(objective), "good");
    expect((await getVocab(objective))?.card).toBeUndefined();
    expect(await allReviews()).toEqual([]);
  });

  it("un mot incident est travaillé sans écriture SRS, même avec une carte", async () => {
    await putVocab({ id: incidental, surface: "宝物", reading: "ほうもつ", meaning: "trésor", tags: [], status: "review", card: newCard(new Date("2026-01-01")) });
    await gradeStoryExercise(typeEx(incidental), "again");
    expect((await getVocab(incidental))?.card?.reps).toBe(0);
    expect(await allReviews()).toEqual([]);
  });

  it("reconstruction de phrase : seuls les objectifs déjà en rotation sont notés", async () => {
    await putVocab({ id: objective, surface: objSurface, reading: objReading, meaning: "x", tags: [], status: "review", card: newCard(new Date("2026-01-01")) });
    const tokens = [
      tok({ surface_form: objSurface, pos: "名詞", reading: objReading, basic_form: objSurface }),
      tok({ surface_form: "宝物", pos: "名詞", reading: "ホウモツ", basic_form: "宝物" }),
    ];
    const ex: BuildExercise = {
      mode: "build",
      key: "build:0",
      track: "vocab",
      id: "build:0",
      front: "…",
      back: "…",
      target: [objSurface, "宝物"],
      tokens,
    };
    await gradeStoryExercise(ex, "good", new Date("2026-01-02"));
    expect((await getVocab(objective))?.card?.reps).toBe(1);
    // Le mot incident n'a même pas été matérialisé avec une carte.
    expect((await getVocab(incidental))?.card).toBeUndefined();
  });
});

describe("niveau atteint et journal (SPEC §5.3, §5.7)", () => {
  const ex = (level: 1 | 2 | 3): TypeExercise => ({
    mode: "type",
    key: "vocab:猫|ねこ#n" + level,
    track: "vocab",
    id: "猫|ねこ",
    front: "chat",
    back: "猫（ねこ）",
    answers: ["ねこ"],
    level,
    form: "written-type",
  });

  it("une réussite élève le niveau atteint, un échec ne le touche pas, rien ne le rabaisse", async () => {
    await putVocab({ id: "猫|ねこ", surface: "猫", reading: "ねこ", meaning: "chat", tags: [], status: "review" });
    await gradeExercise(ex(2), "again");
    expect((await getVocab("猫|ねこ"))?.level).toBeUndefined();
    await gradeExercise(ex(2), "good");
    expect((await getVocab("猫|ねこ"))?.level).toBe(2);
    await gradeExercise(ex(1), "good");
    expect((await getVocab("猫|ねこ"))?.level).toBe(2);
  });

  it("une relance réussie enregistre le niveau sans toucher à la carte", async () => {
    await putVocab({ id: "猫|ねこ", surface: "猫", reading: "ねこ", meaning: "chat", tags: [], status: "review" });
    await recordLevel(ex(3));
    const v = await getVocab("猫|ねこ");
    expect(v?.level).toBe(3);
    expect(v?.card).toBeUndefined();
    expect(await allReviews()).toEqual([]);
  });

  it("le journal porte la forme, le niveau et la durée de réponse", async () => {
    await putVocab({ id: "猫|ねこ", surface: "猫", reading: "ねこ", meaning: "chat", tags: [], status: "review" });
    await gradeExercise(ex(2), "good", new Date(), { ms: 4321.6 });
    const [log] = await allReviews();
    expect(log).toMatchObject({ form: "written-type", level: 2, ms: 4322 });
  });
});
