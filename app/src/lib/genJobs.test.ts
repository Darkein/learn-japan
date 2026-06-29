import { describe, expect, it } from "vitest";
import type { GenJobRecord } from "./db";
import { jobLabel, jobProgress } from "./genJobs";

function makeJob(over: Partial<GenJobRecord>): GenJobRecord {
  const now = Date.now();
  return {
    lessonId: "n5-u1-l1",
    title: "Leçon",
    withFraming: true,
    variant: 1,
    phase: "framing",
    status: "running",
    startedAt: now,
    phaseStartedAt: now,
    updatedAt: now,
    ...over,
  };
}

describe("jobProgress", () => {
  it("part de ~0 au début d'une phase et croît avec le temps écoulé", () => {
    const job = makeJob({ phaseStartedAt: 1000 });
    expect(jobProgress(job, 1000)).toBeCloseTo(0, 5);
    expect(jobProgress(job, 1000 + 5_000)).toBeGreaterThan(jobProgress(job, 1000 + 1_000));
  });

  it("le cours (framing) reste sous son plafond de 40 %", () => {
    const job = makeJob({ phase: "framing", phaseStartedAt: 0 });
    // Même très en retard, on n'atteint jamais le plafond ni 100 %.
    expect(jobProgress(job, 10 * 60_000)).toBeLessThanOrEqual(0.4);
  });

  it("l'histoire d'un job complet démarre au-dessus du plafond du cours (40 %)", () => {
    const job = makeJob({ phase: "story", withFraming: true, phaseStartedAt: 0 });
    expect(jobProgress(job, 1)).toBeGreaterThanOrEqual(0.4);
  });

  it("une histoire seule (sans cours) couvre tout l'intervalle [0, 1]", () => {
    const job = makeJob({ phase: "story", withFraming: false, phaseStartedAt: 0 });
    expect(jobProgress(job, 1)).toBeCloseTo(0, 2);
    expect(jobProgress(job, 5 * 60_000)).toBeGreaterThan(0.9);
  });

  it("ne dépasse jamais 0.99 avant la fin réelle", () => {
    const job = makeJob({ phase: "story", withFraming: false, phaseStartedAt: 0 });
    expect(jobProgress(job, 60 * 60_000)).toBeLessThanOrEqual(0.99);
  });
});

describe("jobLabel", () => {
  it("nomme la phase courante", () => {
    expect(jobLabel(makeJob({ phase: "framing" }))).toMatch(/cours/i);
    expect(jobLabel(makeJob({ phase: "story" }))).toMatch(/histoire/i);
  });

  it("signale l'échec", () => {
    expect(jobLabel(makeJob({ status: "error" }))).toMatch(/échec/i);
  });
});
