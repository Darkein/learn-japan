import { describe, expect, it } from "vitest";
import { pickNext, type FlowState } from "./flow";

/** État de base : rien à faire nulle part. */
function state(over: Partial<FlowState> = {}): FlowState {
  return {
    dueCount: 0,
    newCount: 0,
    reviewedToday: 0,
    dailyGoal: 20,
    flowMsToday: 0,
    omikuji: { drawnToday: true, completedToday: false },
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

  it("omikuji : jamais en tout premier (< 5 min de flux), proposé ensuite", () => {
    const notYet = pickNext(state({ omikuji: { drawnToday: false, completedToday: false } }));
    expect(notYet.kind).not.toBe("omikuji");
    const after = pickNext(
      state({ omikuji: { drawnToday: false, completedToday: false }, flowMsToday: 6 * 60_000 }),
    );
    expect(after.kind).toBe("omikuji");
  });

  it("omikuji : plus jamais proposé une fois tiré", () => {
    const a = pickNext(state({ flowMsToday: 10 * 60_000 }));
    expect(a.kind).not.toBe("omikuji");
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
