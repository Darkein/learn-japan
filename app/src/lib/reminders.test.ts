// « La journée est-elle bouclée ? » — la question qui décide si le rappel du soir part ou
// non (le Worker n'envoie rien pour une journée marquée bouclée). Une réponse trop généreuse
// éteint le rappel de toute une journée pour une visite de deux minutes : d'où ces cas.

import { describe, expect, it } from "vitest";
import { dayIsDone } from "./reminders";
import type { FlowState } from "./flow";

const state = (over: Partial<FlowState> = {}): FlowState => ({
  dueCount: 0,
  hasCards: false,
  stepsToday: 0,
  dailySteps: 3,
  flowMsToday: 0,
  ...over,
});

describe("dayIsDone", () => {
  it("ne boucle pas la journée sur une simple ouverture de l'app", () => {
    // Rien de dû à 8 h → `pickNext` répond déjà « done », mais des cartes tomberont d'ici ce
    // soir : le rappel doit rester armé.
    expect(dayIsDone(state(), "done")).toBe(false);
  });

  it("boucle la journée quand l'objectif du jour est atteint", () => {
    expect(dayIsDone(state({ stepsToday: 3 }), "done")).toBe(true);
    // Même avec du reliquat : la séance continue si on veut, elle n'est pas exigée.
    expect(dayIsDone(state({ stepsToday: 3, dueCount: 12 }), "review")).toBe(true);
  });

  it("boucle une journée courte : plus rien à proposer après avoir travaillé", () => {
    expect(dayIsDone(state({ stepsToday: 1 }), "done")).toBe(true);
  });

  it("ne boucle pas une journée commencée sous l'objectif d'étapes — même avec des révisions", () => {
    expect(dayIsDone(state({ stepsToday: 1, dueCount: 30 }), "vocab")).toBe(false);
  });
});
