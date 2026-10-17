import { describe, expect, it } from "vitest";
import { pickNext, previewFlow, type FlowState } from "./flow";
import { PATH_STEPS, type PathStep } from "./path";

/** État de base : aucune leçon ouverte, aucune carte. */
function state(over: Partial<FlowState> = {}): FlowState {
  return {
    dueCount: 0,
    hasCards: false,
    stepsToday: 0,
    dailySteps: 3,
    flowMsToday: 0,
    ...over,
  };
}

/** Leçon en cours, avec ses sept étapes ; `done` = celles déjà faites. */
function lesson(done: PathStep[] = [], over: Partial<NonNullable<FlowState["currentLesson"]>> = {}) {
  return {
    id: "n5-10",
    title: "Les gens autour de moi",
    steps: [...PATH_STEPS],
    stepsDone: done,
    unreadStoryId: "s1",
    unreadStoryTitle: "Au parc",
    ...over,
  };
}

describe("pickNext — le parcours d'une leçon", () => {
  it("enchaîne les étapes dans l'ordre : la première pas encore faite", () => {
    expect(pickNext(state({ currentLesson: lesson() })).step).toBe("course");
    expect(pickNext(state({ currentLesson: lesson(["course"]) })).step).toBe("vocab");
    expect(pickNext(state({ currentLesson: lesson(["course", "vocab"]) })).step).toBe("grammar");
  });

  it("annonce le rang de l'étape dans le parcours", () => {
    const a = pickNext(state({ currentLesson: lesson(["course", "vocab"]) }));
    expect(a.kind).toBe("grammar");
    expect(a.title).toBe("Étape 3/7 · Grammaire — Les gens autour de moi");
    expect(a.lessonId).toBe("n5-10");
  });

  it("une étape créditée hors ordre est sautée, pas refaite", () => {
    // L'histoire a été lue depuis le Catalogue avant les exercices.
    const a = pickNext(state({ currentLesson: lesson(["course", "vocab", "grammar", "review", "story"]) }));
    expect(a.step).toBe("produce");
  });

  it("l'étape Histoire vise la première histoire non lue, à défaut une histoire de la leçon", () => {
    const done: PathStep[] = ["course", "vocab", "grammar", "review"];
    expect(pickNext(state({ currentLesson: lesson(done) })).refId).toBe("s1");
    const allRead = lesson(done, { unreadStoryId: undefined, anyStoryId: "s0" });
    expect(pickNext(state({ currentLesson: allRead })).refId).toBe("s0");
    // Aucune histoire : la leçon elle-même — l'étape en générera une.
    const none = lesson(done, { unreadStoryId: undefined });
    expect(pickNext(state({ currentLesson: none })).refId).toBe("n5-10");
  });

  it("le contrôle est la dernière étape", () => {
    const a = pickNext(state({ currentLesson: lesson(PATH_STEPS.filter((s) => s !== "exam")) }));
    expect(a.kind).toBe("exam");
    expect(a.refId).toBe("n5-10");
  });

  it("une leçon sans grammaire saute l'étape Grammaire", () => {
    const steps = PATH_STEPS.filter((s) => s !== "grammar");
    const a = pickNext(state({ currentLesson: lesson(["course", "vocab"], { steps }) }));
    expect(a.step).toBe("review");
    expect(a.title).toContain("Étape 3/6");
  });

  it("la leçon en cours passe avant la découverte de la suivante", () => {
    const a = pickNext(
      state({
        currentLesson: lesson(["course"]),
        nextLesson: { id: "n5-25", title: "Aller et venir", ready: true },
      }),
    );
    expect(a.lessonId).toBe("n5-10");
  });

  it("sans leçon en cours, le cours de la prochaine leçon débloquée — même à générer", () => {
    const a = pickNext(state({ nextLesson: { id: "n5-25", title: "Aller et venir", ready: false } }));
    expect(a.kind).toBe("lesson");
    expect(a.step).toBe("course");
    expect(a.refId).toBe("n5-25");
  });
});

describe("pickNext — révision insérée (le retard ralentit le neuf, il ne le gèle jamais)", () => {
  it("plus de deux étapes Révision de retard : une révision devant l'étape nouvelle", () => {
    const a = pickNext(state({ dueCount: 34, currentLesson: lesson(["course"]) }));
    expect(a.kind).toBe("review");
    expect(a.step).toBeUndefined();
    expect(a.title).toContain("34 cartes en attente");
  });

  it("au plus une insertion par étape : juste après une révision, l'étape suit", () => {
    const a = pickNext(state({ dueCount: 90, currentLesson: lesson(["course"]), lastActivity: "review" }));
    expect(a.step).toBe("vocab");
  });

  it("sous le seuil, aucune insertion", () => {
    expect(pickNext(state({ dueCount: 20, currentLesson: lesson(["course"]) })).step).toBe("vocab");
  });

  it("le cours et le contrôle ne sont pas précédés d'une révision insérée", () => {
    expect(pickNext(state({ dueCount: 90, currentLesson: lesson() })).step).toBe("course");
    const beforeExam = lesson(PATH_STEPS.filter((s) => s !== "exam"));
    expect(pickNext(state({ dueCount: 90, currentLesson: beforeExam })).kind).toBe("exam");
  });
});

describe("pickNext — rattrapage après un contrôle échoué", () => {
  const beforeExam = PATH_STEPS.filter((s) => s !== "exam");

  it("révision ciblée des ratés d'abord, puis le contrôle", () => {
    const cur = lesson(beforeExam, { retakePending: ["人|ひと", "n5-iru"] });
    const a = pickNext(state({ currentLesson: cur }));
    expect(a.kind).toBe("review");
    expect(a.itemIds).toEqual(["人|ひと", "n5-iru"]);
    expect(pickNext(state({ currentLesson: cur, lastActivity: "review" })).kind).toBe("exam");
  });
});

describe("pickNext — une séance sans fin", () => {
  it("rien de dû mais des cartes : une étape Révision plutôt qu'une fin", () => {
    const a = pickNext(state({ hasCards: true }));
    expect(a.kind).toBe("review");
    expect(a.reason).toContain("Rien n'est dû");
  });

  it("done seulement quand il n'y a vraiment rien", () => {
    expect(pickNext(state()).kind).toBe("done");
  });

  it("relecture-miroir entre deux étapes, au plus une fois par séance", () => {
    const mirrorCandidate = { storyId: "old", title: "Premier jour", ageDays: 45 };
    const base = { currentLesson: lesson(["course"]), mirrorCandidate };
    // Pas en ouverture de séance : la séance commence par le parcours.
    expect(pickNext(state(base)).step).toBe("vocab");
    const a = pickNext(state({ ...base, lastActivity: "vocab" }));
    expect(a.kind).toBe("mirror");
    expect(a.reason).toContain("45");
    expect(pickNext(state({ ...base, lastActivity: "vocab", mirrorDoneThisFlow: true })).kind).toBe("vocab");
  });

  it("déterminisme : même état → même sortie", () => {
    const s = state({ dueCount: 3, currentLesson: lesson(["course"]), lastActivity: "review" });
    const runs = Array.from({ length: 20 }, () => pickNext({ ...s }));
    expect(new Set(runs.map((a) => `${a.kind}:${a.refId}`)).size).toBe(1);
  });
});

describe("previewFlow — prévisualisation de la carte d'accueil", () => {
  it("annonce les prochaines étapes de la leçon", () => {
    const steps = previewFlow(state({ currentLesson: lesson(["course"]) }));
    expect(steps.map((s) => s.label)).toEqual(["le vocabulaire", "la grammaire", "une révision"]);
  });

  it("annonce la révision insérée quand le retard monte", () => {
    const steps = previewFlow(state({ dueCount: 34, currentLesson: lesson(["course"]) }));
    expect(steps.map((s) => s.label)).toEqual(["une révision", "le vocabulaire", "une révision"]);
  });

  it("s'arrête au contrôle : son issue n'est pas connue d'avance", () => {
    const steps = previewFlow(state({ currentLesson: lesson(["course", "vocab", "grammar", "review", "story"]) }), 5);
    expect(steps.map((s) => s.label)).toEqual(["la production", "le contrôle"]);
  });

  it("annonce une nouvelle leçon sans en deviner les étapes", () => {
    const steps = previewFlow(state({ nextLesson: { id: "n5-25", title: "Aller et venir", ready: true } }));
    expect(steps.map((s) => s.label)).toEqual(["une nouvelle leçon"]);
  });

  it("rien à faire → aucune étape", () => {
    expect(previewFlow(state())).toEqual([]);
  });

  it("pureté : l'état passé n'est pas muté", () => {
    const s = state({ dueCount: 34, currentLesson: lesson(["course"]) });
    const snapshot = structuredClone(s);
    previewFlow(s);
    expect(s).toEqual(snapshot);
  });
});

describe("pickNext — station de repos (toutes les 5 leçons)", () => {
  const restDue = { key: "n5-28-yes-polite", lessonIds: ["a", "b", "c", "d", "e"] };

  it("entre deux leçons, la station passe avant le cours suivant", () => {
    const a = pickNext(state({ restDue, nextLesson: { id: "n5-06", title: "La météo", ready: true } }));
    expect(a.kind).toBe("rest");
    expect(a.lessonIds).toEqual(restDue.lessonIds);
    expect(a.step).toBeUndefined();
  });

  it("jamais au milieu d'une leçon en cours", () => {
    expect(pickNext(state({ restDue, currentLesson: lesson(["course"]) })).kind).toBe("vocab");
  });

  it("l'aperçu l'annonce, puis la leçon suivante", () => {
    const steps = previewFlow(state({ restDue, nextLesson: { id: "n5-06", title: "La météo", ready: true } }));
    expect(steps.map((s) => s.label)).toEqual(["une station de repos", "une nouvelle leçon"]);
  });
});
