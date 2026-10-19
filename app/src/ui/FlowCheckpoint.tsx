import { useEffect, useState, type ReactNode } from "react";
import type { FlowActivity } from "../lib/flow";
import type { Lesson } from "../lib/lessons";
import { STEP_LABEL, type PathStep } from "../lib/path";
import { LessonPath } from "./LessonPath";
import { Button } from "./kit/Button";
import { SectionLabel } from "./kit/SectionLabel";

export interface FlowBlockResult {
  kind: FlowActivity["kind"];
  /** Phrase de récap du bloc accompli (« 12 révisions faites », « Histoire lue »…). */
  recap?: string;
  /** Contenu riche optionnel (delta de la relecture-miroir, phase F). */
  extra?: ReactNode;
}

/** Délai avant d'enchaîner seul sur l'étape suivante. */
const AUTO_CONTINUE_MS = 3000;

interface Props {
  result: FlowBlockResult | null;
  next: FlowActivity;
  /** Ce que demande l'activité suivante (« 8 exercices · ~3 min »). */
  estimate?: string;
  /** Leçon en cours : ses stations, pour voir le chemin parcouru. */
  lesson?: Lesson;
  /** L'étape de la leçon qu'on vient de finir : le repère part de là. */
  from?: PathStep;
  /** Suspend l'enchaînement automatique (une arrivée de station est à l'écran). */
  paused?: boolean;
  onContinue: () => void;
  onExit: () => void;
}

/**
 * Passage d'une étape à la suivante : une ligne de récap, le repère qui glisse d'une station
 * à l'autre, puis le parcours enchaîne seul — un toucher sur l'écran retient l'enchaînement,
 * et la sortie reste toujours là : la séance n'a pas de fin imposée (SPEC §5.1).
 * Un bilan à lire (delta du miroir) ou l'absence de suite désarment l'enchaînement.
 */
export function FlowCheckpoint({ result, next, estimate, lesson, from, paused, onContinue, onExit }: Props) {
  const done = next.kind === "done";
  const [held, setHeld] = useState(false);
  const auto = !done && !!result && !result.extra && !held && !paused;

  useEffect(() => {
    if (!auto) return;
    const id = window.setTimeout(onContinue, AUTO_CONTINUE_MS);
    return () => window.clearTimeout(id);
  }, [auto, onContinue]);

  const inPath = !!(lesson && next.step && next.lessonId === lesson.id);
  return (
    <div
      className="flex animate-rise flex-col gap-5"
      // Toucher hors des boutons = « attends » : on reste sur le checkpoint.
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("button")) setHeld(true);
      }}
    >
      {result?.recap && (
        <p className="m-0 flex gap-2 text-sm text-muted">
          <span aria-hidden="true" className="text-accent">
            ✓
          </span>
          <span>{result.recap}</span>
        </p>
      )}
      {result?.extra}
      {lesson && <LessonPath lesson={lesson} from={from} />}
      <div className="flex flex-col gap-1">
        {!done && <SectionLabel>Ensuite</SectionLabel>}
        <p className="m-0 font-serif text-lg text-text">
          {done ? next.reason : inPath && next.step ? STEP_LABEL[next.step] : next.title}
        </p>
        {!done && (
          <p className="m-0 text-sm text-muted">
            {next.reason}
            {/* Une étape de la leçon a déjà son estimation sous les stations. */}
            {estimate && !inPath ? ` (${estimate})` : ""}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        {!done && (
          <Button variant="primary" className="relative overflow-hidden" onClick={onContinue}>
            {auto && (
              <span
                aria-hidden="true"
                className="flow-countdown absolute inset-0 origin-left bg-on-accent/20"
                style={{ animationDuration: `${AUTO_CONTINUE_MS}ms` }}
              />
            )}
            <span className="relative">Continuer</span>
          </Button>
        )}
        <Button variant={done ? "primary" : "ghost"} onClick={onExit}>
          Arrêter ici
        </Button>
      </div>
    </div>
  );
}
