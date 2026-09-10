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

/** Leçon en cours normalement travaillée : cours lu, une histoire lue, une autre en attente. */
const lessonInProgress = {
  id: "n5-01",
  title: "Se présenter",
  unreadStoryId: "s1",
  unreadStoryTitle: "Au café",
  courseRead: true,
  courseReady: true,
  storyRead: true,
};

describe("pickNext — barème", () => {
  it("priorité aux révisions quand l'objectif n'est pas atteint", () => {
    const a = pickNext(state({ dueCount: 12, reviewedToday: 5 }));
    expect(a.kind).toBe("review");
    expect(a.title).toContain("12");
  });

  it("le bouton annonce la dose du bloc, et le retard derrière", () => {
    // 42 dues, objectif 10 : le bloc en sert 10 — c'est ce chiffre qui doit s'afficher.
    const a = pickNext(state({ dueCount: 42, dailyGoal: 10 }));
    expect(a.kind).toBe("review");
    expect(a.title).toBe("Révisions (10 sur 42 dues)");
  });

  it("le bloc atteint l'objectif → on passe à la suite le jour même", () => {
    const a = pickNext(
      state({
        dueCount: 32,
        dailyGoal: 10,
        reviewedToday: 10,
        nextLesson: { id: "n5-02", title: "Compter", ready: true },
      }),
    );
    expect(a.kind).toBe("lesson");
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

describe("pickNext — le contrôle exige une leçon réellement travaillée", () => {
  const examOpen = { ...lessonInProgress, unreadStoryId: undefined, unreadStoryTitle: undefined, examDue: true };

  it("propose le contrôle quand le cours a été lu et une histoire lue", () => {
    const a = pickNext(state({ reviewedToday: 20, currentLesson: examOpen }));
    expect(a.kind).toBe("exam");
    expect(a.refId).toBe("n5-01");
  });

  it("pas de contrôle sur une leçon dont le cours n'a jamais été lu : on donne le cours", () => {
    const a = pickNext(
      state({ reviewedToday: 20, currentLesson: { ...examOpen, courseRead: false } }),
    );
    expect(a.kind).toBe("lesson");
    expect(a.refId).toBe("n5-01");
    expect(a.reason).toContain("sans jamais lire son cours");
  });

  it("le cours de la leçon en cours passe AVANT la découverte de la suivante", () => {
    const a = pickNext(
      state({
        reviewedToday: 20,
        currentLesson: { ...examOpen, courseRead: false },
        nextLesson: { id: "n5-02", title: "Compter", ready: true },
      }),
    );
    expect(a.refId).toBe("n5-01");
  });

  it("cours indisponible (leçon à générer) : ni cours ni contrôle proposés", () => {
    const a = pickNext(
      state({
        reviewedToday: 20,
        currentLesson: { ...examOpen, courseRead: false, courseReady: false },
      }),
    );
    expect(a.kind).toBe("done");
  });

  it("pas de contrôle tant qu'aucune histoire de la leçon n'a été lue", () => {
    const a = pickNext(
      state({
        reviewedToday: 20,
        currentLesson: { ...examOpen, storyRead: false, unreadStoryId: "s1", unreadStoryTitle: "Au café" },
      }),
    );
    expect(a.kind).toBe("read-story");
  });

  it("cours relu une seule fois : après le bloc leçon, on n'y revient pas", () => {
    const a = pickNext(
      state({
        reviewedToday: 20,
        currentLesson: { ...examOpen, courseRead: false },
        lastActivity: "lesson",
      }),
    );
    expect(a.kind).not.toBe("lesson");
  });
});

describe("previewFlow — prévisualisation de la carte d'accueil", () => {
  it("annonce les révisions jusqu'à l'objectif du jour, puis une lecture", () => {
    // 34 dues mais un objectif de 20 : la phase de révision en demande 20, pas 34 —
    // annoncer tout le retard promettait une session que le flux ne sert pas.
    const steps = previewFlow(state({ dueCount: 34, currentLesson: lessonInProgress }));
    // Les 14 dues restantes partent en renforcement, facultatif — pas dans la phase de
    // révision, qui s'arrête à l'objectif.
    expect(steps.map((s) => s.label)).toEqual([
      "20 révisions",
      "une lecture",
      "un bloc de renforcement",
    ]);
  });

  it("petit objectif : le retard ne gonfle pas l'annonce", () => {
    const steps = previewFlow(
      state({ dueCount: 42, dailyGoal: 10, currentLesson: lessonInProgress }),
      2,
    );
    expect(steps.map((s) => s.label)).toEqual(["10 révisions", "une lecture"]);
  });

  it("objectif atteint : au plus 2 blocs de renforcement puis fin", () => {
    const steps = previewFlow(state({ dueCount: 90, reviewedToday: 25 }), 5);
    expect(steps.map((s) => s.kind)).toEqual(["reinforce", "reinforce"]);
  });

  it("annonce le cours de la leçon avant son contrôle", () => {
    const steps = previewFlow(
      state({
        reviewedToday: 25,
        currentLesson: { ...lessonInProgress, unreadStoryId: undefined, courseRead: false, examDue: true },
      }),
      3,
    );
    expect(steps.map((s) => s.label)).toEqual(["le cours de ta leçon", "le contrôle de la leçon"]);
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
