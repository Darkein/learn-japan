import { useEffect, useState } from "react";
import type { Lesson } from "../lib/lessons";
import { STEP_LABEL, stepNumber, type PathStep } from "../lib/path";
import { estimateLabel, loadFormDurations, stepPlan, type StepEstimate } from "../lib/pathPlan";

type PathLesson = Pick<
  Lesson,
  "steps" | "stepsDone" | "nextStep" | "vocabCount" | "grammarCount" | "vocabToLearn" | "grammarToLearn"
>;

/** Durées mesurées par forme d'exercice (journal), chargées une fois par composant. */
export function useFormDurations(): Map<string, number> {
  const [ms, setMs] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void loadFormDurations().then(setMs);
  }, []);
  return ms;
}

/** Estimation de chaque étape d'une leçon (SPEC §5.2). */
export function usePlan(lesson: PathLesson): StepEstimate[] {
  const ms = useFormDurations();
  return stepPlan(lesson, ms);
}

type StepState = "done" | "next" | "todo";

function stateOf(lesson: PathLesson, step: PathStep): StepState {
  if (lesson.stepsDone.includes(step)) return "done";
  return lesson.nextStep === step ? "next" : "todo";
}

/** Une station : pleine faite, cerclée d'accent la prochaine, en filet celles à venir. */
function Station({ state }: { state: StepState }) {
  const cls =
    state === "done"
      ? "bg-accent"
      : state === "next"
        ? "border-2 border-accent bg-bg"
        : "border border-hairline-strong bg-bg";
  return <span aria-hidden="true" className={`block h-3 w-3 shrink-0 rounded-full ${cls}`} />;
}

/**
 * Le parcours d'une leçon (SPEC §5.2) : ses étapes comme les stations d'une route.
 *
 * - `strip` (accueil, checkpoint) : la bande des stations, et sous elle l'étape suivante
 *   avec ce qu'elle demande (« Étape 3/7 · Grammaire · 8 exercices · ~3 min »).
 * - `list` (page de la leçon) : toutes les étapes, chacune avec son état et sa durée.
 */
export function LessonPath({
  lesson,
  variant = "strip",
  from,
}: {
  lesson: PathLesson;
  variant?: "strip" | "list";
  /** `strip` seulement : la station d'où l'on vient (l'étape qu'on vient de finir). Le
   *  repère de la prochaine étape part de là et glisse jusqu'à elle. */
  from?: PathStep;
}) {
  const plan = usePlan(lesson);
  const n = lesson.steps.length;
  const fromIdx = from ? lesson.steps.indexOf(from) : -1;
  const toIdx = lesson.nextStep ? lesson.steps.indexOf(lesson.nextStep) : -1;
  const travels = variant === "strip" && fromIdx >= 0 && toIdx >= 0 && n > 1;
  // Le repère se pose d'abord sur la station quittée, puis glisse à la suivante.
  const [at, setAt] = useState(travels ? fromIdx : toIdx);
  useEffect(() => {
    if (!travels) return;
    setAt(fromIdx);
    const id = window.setTimeout(() => setAt(toIdx), 250);
    return () => window.clearTimeout(id);
  }, [travels, fromIdx, toIdx]);
  const estimate = (step: PathStep) => plan.find((e) => e.step === step);

  if (variant === "list") {
    return (
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Parcours de la leçon">
        {lesson.steps.map((step, i) => {
          const state = stateOf(lesson, step);
          const e = estimate(step);
          return (
            <li key={step} className="flex items-center gap-3 border-t border-hairline py-2.5 first:border-t-0">
              <Station state={state} />
              <span className={`flex-1 text-sm ${state === "todo" ? "text-muted" : "text-text"}`}>
                {i + 1}. {STEP_LABEL[step]}
              </span>
              <span className={`text-xs ${state === "next" ? "text-accent" : "text-muted"}`}>
                {state === "done" ? "fait" : e ? estimateLabel(e) : ""}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  const next = lesson.nextStep;
  const e = next ? estimate(next) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative flex items-center"
        role="img"
        aria-label={`${lesson.stepsDone.length} étapes faites sur ${lesson.steps.length}`}
      >
        {lesson.steps.map((step, i) => (
          <span key={step} className={`flex items-center ${i < lesson.steps.length - 1 ? "flex-1" : ""}`}>
            <span title={STEP_LABEL[step]}>
              {/* Le repère mobile tient lieu de station « prochaine » : celle-ci reste en filet. */}
              <Station state={travels && stateOf(lesson, step) === "next" ? "todo" : stateOf(lesson, step)} />
            </span>
            {i < lesson.steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`mx-1 h-px flex-1 ${lesson.stepsDone.includes(step) ? "bg-accent" : "bg-hairline"}`}
              />
            )}
          </span>
        ))}
        {travels && (
          <span
            aria-hidden="true"
            className="absolute top-1/2 block h-3 w-3 -translate-y-1/2 rounded-full border-2 border-accent bg-bg transition-[left] duration-700"
            style={{ left: `calc((100% - 0.75rem) * ${at / (n - 1)})` }}
          />
        )}
      </div>
      {next && (
        <span className="text-xs text-muted">
          Étape {stepNumber(lesson.steps, next)}/{lesson.steps.length} · {STEP_LABEL[next]}
          {e ? ` · ${estimateLabel(e)}` : ""}
        </span>
      )}
    </div>
  );
}
