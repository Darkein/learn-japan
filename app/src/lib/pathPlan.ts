// Durée annoncée des étapes du parcours (SPEC §5.2, §5.7) : avant de commencer une étape,
// on sait combien d'exercices elle compte et combien de temps elle prend. Le calcul est PUR
// (`stepPlan`) ; seules les durées par forme d'exercice viennent du journal de révisions
// (`loadFormDurations`), à défaut des valeurs par défaut ci-dessous.

import { allReviews } from "./db";
import { REVIEW_STEP_SIZE, type PathStep } from "./path";

/**
 * Durée par défaut d'un exercice, par forme (ms) — tant que le journal n'en a pas assez
 * mesuré. Calée sur ce qu'on observait avant les mesures : 15 à 20 s en moyenne, moins pour
 * un QCM, davantage pour une phrase à reconstruire.
 */
export const DEFAULT_FORM_MS: Record<string, number> = {
  "written-choice": 9_000,
  "written-type": 15_000,
  "listen-meaning": 12_000,
  "listen-word": 15_000,
  dictation: 30_000,
  production: 25_000,
  "grammar-rule": 12_000,
  "grammar-usage": 15_000,
  "grammar-build": 30_000,
  "grammar-correction": 20_000,
  "grammar-dictation": 30_000,
  "grammar-review": 20_000,
};

/** Durée par défaut d'une forme inconnue. */
const FALLBACK_MS = 15_000;

/** Durées fixes (ms) des étapes qui ne sont pas des séances d'exercices. */
const COURSE_MS = 4 * 60_000;
const STORY_READING_MS = 6 * 60_000;
const STORY_EXERCISES = 6;
const EXAM_MS = 8 * 60_000;

/** Ce qu'une leçon doit encore apprendre : de quoi dimensionner ses étapes. */
export interface PlanInput {
  steps: PathStep[];
  /** Mots et points pas encore acquis (servis par les étapes Vocabulaire et Grammaire). */
  vocabToLearn: number;
  grammarToLearn: number;
  /** Tous les mots et points de la leçon (servis par l'étape Produire). */
  vocabCount: number;
  grammarCount: number;
}

export interface StepEstimate {
  step: PathStep;
  /** Nombre d'exercices, quand l'étape est une séance d'exercices. */
  exercises?: number;
  /** Durée estimée, en minutes entières (au moins 1). */
  minutes: number;
}

/** Durée d'une forme : la mesurée, à défaut celle par défaut. */
function formMs(ms: Map<string, number>, form: string): number {
  return ms.get(form) ?? DEFAULT_FORM_MS[form] ?? FALLBACK_MS;
}

function minutes(totalMs: number): number {
  return Math.max(1, Math.round(totalMs / 60_000));
}

/**
 * Estimation de chaque étape d'une leçon. Les séances reprennent la composition de
 * lib/reviewSession.ts : deux exercices par mot à apprendre (QCM puis saisie), quatre par
 * point (rôle, emploi, phrase, correction), une production par mot et deux par point.
 */
export function stepPlan(input: PlanInput, ms: Map<string, number> = new Map()): StepEstimate[] {
  const f = (form: string) => formMs(ms, form);
  return input.steps.map((step): StepEstimate => {
    switch (step) {
      case "course":
        return { step, minutes: minutes(COURSE_MS) };
      case "vocab": {
        const n = input.vocabToLearn;
        return { step, exercises: 2 * n, minutes: minutes(n * (f("written-choice") + f("written-type"))) };
      }
      case "grammar": {
        const n = input.grammarToLearn;
        const per = f("grammar-rule") + f("grammar-usage") + f("grammar-build") + f("grammar-correction");
        return { step, exercises: 4 * n, minutes: minutes(n * per) };
      }
      case "review": {
        const per = (f("written-choice") + f("written-type") + f("listen-meaning") + f("production")) / 4;
        return { step, exercises: REVIEW_STEP_SIZE, minutes: minutes(REVIEW_STEP_SIZE * per) };
      }
      case "story":
        return {
          step,
          exercises: STORY_EXERCISES,
          minutes: minutes(STORY_READING_MS + STORY_EXERCISES * f("written-choice")),
        };
      case "produce": {
        const total =
          input.vocabCount * f("production") + input.grammarCount * (f("grammar-dictation") + f("grammar-build"));
        return { step, exercises: input.vocabCount + 2 * input.grammarCount, minutes: minutes(total) };
      }
      case "exam":
        return { step, minutes: minutes(EXAM_MS) };
    }
  });
}

/** Libellé court d'une estimation : « 8 exercices · ~3 min ». */
export function estimateLabel(e: Pick<StepEstimate, "exercises" | "minutes">): string {
  const ex = e.exercises ? `${e.exercises} exercice${e.exercises > 1 ? "s" : ""} · ` : "";
  return `${ex}~${e.minutes} min`;
}

/** Nombre minimal de mesures d'une forme avant de remplacer sa durée par défaut. */
const MIN_SAMPLES = 5;
/** Mesures retenues par forme : les plus récentes (le rythme évolue). */
const RECENT_SAMPLES = 100;
/** Au-delà, la réponse a sans doute attendu une pause : la mesure est écartée. */
const MAX_MS = 3 * 60_000;

/** Médiane d'une liste non vide. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Durée médiane de réponse par forme, mesurée dans le journal (`ReviewLog.ms`, SPEC §5.7).
 * Une forme trop peu mesurée garde sa durée par défaut.
 */
export function formDurations(logs: { form?: string; ms?: number; at: number }[]): Map<string, number> {
  const byForm = new Map<string, { at: number; ms: number }[]>();
  for (const l of logs) {
    if (!l.form || l.ms == null || l.ms <= 0 || l.ms > MAX_MS) continue;
    const list = byForm.get(l.form) ?? [];
    list.push({ at: l.at, ms: l.ms });
    byForm.set(l.form, list);
  }
  const out = new Map<string, number>();
  for (const [form, list] of byForm) {
    if (list.length < MIN_SAMPLES) continue;
    const recent = list.sort((a, b) => b.at - a.at).slice(0, RECENT_SAMPLES);
    out.set(form, median(recent.map((x) => x.ms)));
  }
  return out;
}

export async function loadFormDurations(): Promise<Map<string, number>> {
  return formDurations(await allReviews());
}
