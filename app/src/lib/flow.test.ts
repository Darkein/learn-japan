import { describe, expect, it } from "vitest";
import { pickNext, previewFlow, type FlowState } from "./flow";

/** État de base : rien à faire nulle part. */
function state(over: Partial<FlowState> = {}): FlowState {
  return {
    dueCount: 0,
    newCount: 0,
    reviewedToday: 0,
    dailyGoal: 20,
    flowMsToday: 0,
    ...over,
  };
}

const lessonInProgress = {
  id: "n5-01",
  title: "Se présenter",
  unreadStoryId: "s1",
  unreadStoryTitle: "Au café",
};

describe("pickNext — barème", () => {
  it("priorité aux révisions quand l'objectif n'est pas atteint", () => {
    const a = pickNext(state({ dueCount: 12, reviewedToday: 5 }));
    expect(a.kind).toBe("review");
    expect(a.title).toContain("12");
  });

  it("alternance : lecture d'une histoire de la leçon juste après un bloc de révision", () => {
    const a = pickNext(
      state({ dueCount: 12, reviewedToday: 5, lastActivity: "review", currentLesson: lessonInProgress }),
    );
    expect(a.kind).toBe("read-story");
    expect(a.refId).toBe("s1");
  });

  it("enchaîne les blocs de révision s'il n'y a rien à alterner", () => {
    const a = pickNext(state({ dueCount: 40, reviewedToday: 10, dailyGoal: 50, lastActivity: "review" }));
    expect(a.kind).toBe("review");
  });

  it("leçon suivante quand elle est prête et l'objectif atteint", () => {
    const a = pickNext(
      state({ reviewedToday: 20, nextLesson: { id: "n5-02", title: "Compter", ready: true } }),
    );
    expect(a.kind).toBe("lesson");
    expect(a.refId).toBe("n5-02");
  });

  it("pas de leçon si elle n'est pas prête (à générer)", () => {
    const a = pickNext(
      state({ reviewedToday: 20, nextLesson: { id: "n5-02", title: "Compter", ready: false } }),
    );
    expect(a.kind).toBe("done");
  });

  it("relecture-miroir quand un candidat existe", () => {
    const a = pickNext(
      state({ mirrorCandidate: { storyId: "old", title: "Premier jour", ageDays: 45 } }),
    );
    expect(a.kind).toBe("mirror");
    expect(a.reason).toContain("45");
  });

  it("lecture plaisir même sans révision préalable s'il ne reste que ça", () => {
    const a = pickNext(state({ currentLesson: lessonInProgress }));
    expect(a.kind).toBe("read-story");
  });

  it("renforcement quand l'objectif est atteint mais du dû reste", () => {
    const a = pickNext(state({ dueCount: 8, reviewedToday: 25, lastActivity: "review" }));
    expect(a.kind).toBe("reinforce");
  });

  it("alternance : lecture aussi après un bloc de renforcement", () => {
    const a = pickNext(
      state({ dueCount: 8, reviewedToday: 25, lastActivity: "reinforce", currentLesson: lessonInProgress }),
    );
    expect(a.kind).toBe("read-story");
  });

  it("renforcement plafonné : encore un bloc à 1, done à 2 même avec du dû", () => {
    const base = { dueCount: 8, reviewedToday: 25 };
    expect(pickNext(state({ ...base, reinforceCountThisFlow: 1 })).kind).toBe("reinforce");
    expect(pickNext(state({ ...base, reinforceCountThisFlow: 2 })).kind).toBe("done");
  });

  it("done — sortie élégante quand tout est épuisé", () => {
    const a = pickNext(state({ reviewedToday: 25, lastActivity: "review" }));
    expect(a.kind).toBe("done");
    expect(a.reason).toContain("La route t'attend demain");
  });

  it("déterminisme : même état → même sortie", () => {
    const s = state({ dueCount: 3, currentLesson: lessonInProgress, lastActivity: "review" });
    const runs = Array.from({ length: 20 }, () => pickNext({ ...s }));
    expect(new Set(runs.map((a) => `${a.kind}:${a.refId}`)).size).toBe(1);
  });
});

describe("previewFlow — prévisualisation de la carte d'accueil", () => {
  it("annonce les révisions, puis une lecture", () => {
    const steps = previewFlow(state({ dueCount: 34, currentLesson: lessonInProgress }));
    expect(steps.map((s) => s.label)).toEqual(["34 révisions", "une lecture"]);
  });

  it("objectif atteint : au plus 2 blocs de renforcement puis fin", () => {
    const steps = previewFlow(state({ dueCount: 90, reviewedToday: 25 }), 5);
    expect(steps.map((s) => s.kind)).toEqual(["reinforce", "reinforce"]);
  });

  it("rien à faire → aucune étape", () => {
    expect(previewFlow(state({ reviewedToday: 25 }))).toEqual([]);
  });

  it("pureté : l'état passé n'est pas muté", () => {
    const s = state({ dueCount: 34, currentLesson: { ...lessonInProgress } });
    const snapshot = structuredClone(s);
    previewFlow(s);
    expect(s).toEqual(snapshot);
  });
});
