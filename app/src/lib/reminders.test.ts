// « La journée est-elle bouclée ? » — la question qui décide si le rappel du soir part ou
// non (le Worker n'envoie rien pour une journée marquée bouclée). Une réponse trop généreuse
// éteint le rappel de toute une journée pour une visite de deux minutes : d'où ces cas.

import { describe, expect, it } from "vitest";
import { dayIsDone } from "./reminders";
import type { FlowState } from "./flow";

const state = (over: Partial<FlowState> = {}): FlowState => ({
  dueCount: 0,
  newCount: 0,
  reviewedToday: 0,
  dailyGoal: 20,
  flowMsToday: 0,
  omikuji: { drawnToday: false, completedToday: false },
  ...over,
});

describe("dayIsDone", () => {
  it("ne boucle pas la journée sur une simple ouverture de l'app", () => {
    // Rien de dû à 8 h → `pickNext` répond déjà « done », mais des cartes tomberont d'ici ce
    // soir : le rappel doit rester armé.
    expect(dayIsDone(state(), "done")).toBe(false);
  });

  it("boucle la journée quand l'objectif du jour est atteint", () => {
    expect(dayIsDone(state({ reviewedToday: 20 }), "done")).toBe(true);
    // Même avec du reliquat : le renforcement est offert, pas exigé.
    expect(dayIsDone(state({ reviewedToday: 20, dueCount: 12 }), "reinforce")).toBe(true);
  });

  it("boucle une journée courte : plus rien à faire après avoir révisé", () => {
    expect(dayIsDone(state({ reviewedToday: 4 }), "done")).toBe(true);
  });

  it("ne boucle pas une journée commencée mais inachevée", () => {
    expect(dayIsDone(state({ reviewedToday: 4, dueCount: 30 }), "review")).toBe(false);
  });
});
