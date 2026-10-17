import { describe, expect, it } from "vitest";
import { PATH_STEPS } from "./path";
import { DEFAULT_FORM_MS, estimateLabel, formDurations, stepPlan } from "./pathPlan";

const lesson = { steps: [...PATH_STEPS], vocabToLearn: 8, grammarToLearn: 2, vocabCount: 8, grammarCount: 2 };

describe("stepPlan — taille et durée des étapes (SPEC §5.2)", () => {
  it("dimensionne les séances d'après la leçon", () => {
    const plan = stepPlan(lesson);
    const by = (s: string) => plan.find((e) => e.step === s)!;
    expect(by("vocab").exercises).toBe(16);
    expect(by("grammar").exercises).toBe(8);
    expect(by("review").exercises).toBe(10);
    expect(by("produce").exercises).toBe(12);
    expect(by("course").exercises).toBeUndefined();
  });

  it("une leçon de 10 éléments prend environ 35 minutes avec les durées par défaut", () => {
    const total = stepPlan(lesson).reduce((s, e) => s + e.minutes, 0);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(42);
  });

  it("rien à apprendre : l'étape ne compte aucun exercice, et dure au moins une minute", () => {
    const e = stepPlan({ ...lesson, vocabToLearn: 0 }).find((x) => x.step === "vocab")!;
    expect(e).toEqual({ step: "vocab", exercises: 0, minutes: 1 });
  });

  it("les durées mesurées remplacent les défauts", () => {
    const slow = new Map([["written-choice", 60_000], ["written-type", 60_000]]);
    const e = stepPlan(lesson, slow).find((x) => x.step === "vocab")!;
    expect(e.minutes).toBe(16);
  });
});

describe("formDurations — médiane mesurée par forme (SPEC §5.7)", () => {
  const log = (form: string, ms: number, at = 0) => ({ form, ms, at });

  it("médiane des mesures, après assez d'échantillons seulement", () => {
    const logs = [7, 8, 9, 10, 30].map((s, i) => log("written-choice", s * 1000, i));
    expect(formDurations(logs).get("written-choice")).toBe(9000);
    expect(formDurations(logs.slice(0, 4)).has("written-choice")).toBe(false);
  });

  it("écarte les mesures aberrantes (pause pendant l'exercice) et les journaux sans forme", () => {
    const logs = [...[1, 2, 3, 4, 5].map((i) => log("production", 20_000, i)), log("production", 600_000, 9), { ms: 5000, at: 1 }];
    expect(formDurations(logs).get("production")).toBe(20_000);
  });

  it("libellé : « 8 exercices · ~3 min »", () => {
    expect(estimateLabel({ exercises: 8, minutes: 3 })).toBe("8 exercices · ~3 min");
    expect(estimateLabel({ minutes: 4 })).toBe("~4 min");
    expect(DEFAULT_FORM_MS["written-choice"]).toBeLessThan(DEFAULT_FORM_MS["grammar-build"]);
  });
});
