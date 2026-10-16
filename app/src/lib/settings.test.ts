import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "./settings";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("passage au parcours (SPEC §5.8)", () => {
  it("l'objectif en cartes repasse au défaut en étapes, et reste mémorisé pour la série", () => {
    store.set("settings", JSON.stringify({ dailyGoal: 10, newPerDay: 5, theme: "dark" }));
    const s = loadSettings();
    expect(s.dailySteps).toBe(3);
    expect(s.legacyCardGoal).toBe(10);
    expect(s.pathSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.theme).toBe("dark");
    // « Nouveaux mots par jour » et l'ancien objectif ne survivent pas en base.
    const saved = JSON.parse(store.get("settings")!);
    expect(saved).not.toHaveProperty("newPerDay");
    expect(saved).not.toHaveProperty("dailyGoal");
  });

  it("la migration ne passe qu'une fois : la date du passage ne bouge plus", () => {
    store.set("settings", JSON.stringify({ dailyGoal: 10 }));
    const first = loadSettings();
    store.set("settings", JSON.stringify({ ...JSON.parse(store.get("settings")!), dailySteps: 5 }));
    const again = loadSettings();
    expect(again.dailySteps).toBe(5);
    expect(again.pathSince).toBe(first.pathSince);
  });

  it("un profil vierge part directement du parcours, sans règle d'avant", () => {
    const s = loadSettings();
    expect(s.dailySteps).toBe(3);
    expect(s.pathSince).toBeUndefined();
  });
});
