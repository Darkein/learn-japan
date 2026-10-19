import { useEffect, useState } from "react";
import { gatherFlowState, pickNext, type FlowActivity } from "../lib/flow";
import type { Lesson } from "../lib/lessons";
import { STEP_LABEL, stepNumber, type PathStep } from "../lib/path";
import { estimateLabel, loadFormDurations, stepPlan, type StepEstimate } from "../lib/pathPlan";

type PathLesson = Pick<
  Lesson,
  | "id"
  | "steps" | "stepsDone" | "nextStep" | "vocabCount" | "grammarCount" | "vocabToLearn" | "grammarToLearn"
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

/**
 * La révision insérée qui attend devant la prochaine étape de cette leçon (§5.4), s'il y en
 * a une : le parcours la propose avant la suite, les stations la montrent à sa place.
 */
function usePendingDetour(lessonId: string): FlowActivity | undefined {
  const [detour, setDetour] = useState<FlowActivity>();
  useEffect(() => {
    let live = true;
    void gatherFlowState().then(({ state }) => {
      const a = pickNext(state);
      if (live) setDetour(a.kind === "review" && a.before && a.lessonId === lessonId ? a : undefined);
    });
    return () => {
      live = false;
    };
  }, [lessonId]);
  return detour;
}

/** Le détour d'une révision insérée : un petit 復 sans numéro, cerclé d'accent (à faire). */
function Detour() {
  return (
    <span
      aria-hidden="true"
      className="-mx-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-accent bg-bg font-jp text-[8px] leading-none text-accent"
    >
      復
    </span>
  );
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
export function LessonPath({ lesson, variant = "strip" }: { lesson: PathLesson; variant?: "strip" | "list" }) {
  const plan = usePlan(lesson);
  const estimate = (step: PathStep) => plan.find((e) => e.step === step);
  const detour = usePendingDetour(lesson.id);

  if (variant === "list") {
    return (
      <ol className="m-0 flex list-none flex-col p-0" aria-label="Parcours de la leçon">
        {lesson.steps.flatMap((step, i) => {
          const state = stateOf(lesson, step);
          const e = estimate(step);
          const row = (
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
          if (detour?.before !== step) return [row];
          // Sans numéro : le détour ne décale pas les étapes de la leçon.
          return [
            <li key="detour" className="flex items-center gap-3 border-t border-hairline py-2.5">
              <Detour />
              <span className="flex-1 text-sm text-text">Révision insérée</span>
              <span className="text-xs text-accent">{detour.title.replace(/^Révision · /, "")}</span>
            </li>,
            row,
          ];
        })}
      </ol>
    );
  }

  const next = lesson.nextStep;
  const e = next ? estimate(next) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center"
        role="img"
        aria-label={`${lesson.stepsDone.length} étapes faites sur ${lesson.steps.length}`}
      >
        {lesson.steps.map((step, i) => (
          <span key={step} className={`flex items-center ${i < lesson.steps.length - 1 ? "flex-1" : ""}`}>
            {detour?.before === step && (
              <span title={detour.title} className="mr-1 flex items-center">
                <Detour />
              </span>
            )}
            <span title={STEP_LABEL[step]}>
              <Station state={stateOf(lesson, step)} />
            </span>
            {i < lesson.steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`mx-1 h-px flex-1 ${lesson.stepsDone.includes(step) ? "bg-accent" : "bg-hairline"}`}
              />
            )}
          </span>
        ))}
      </div>
      {detour && <span className="text-xs text-accent">D'abord : {detour.title}</span>}
      {next && (
        <span className="text-xs text-muted">
          {detour ? "Puis : " : ""}Étape {stepNumber(lesson.steps, next)}/{lesson.steps.length} · {STEP_LABEL[next]}
          {e ? ` · ${estimateLabel(e)}` : ""}
        </span>
      )}
    </div>
  );
}
