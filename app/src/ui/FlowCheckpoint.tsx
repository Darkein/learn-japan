import type { ReactNode } from "react";
import type { FlowActivity } from "../lib/flow";
import type { Lesson } from "../lib/lessons";
import { LessonPath } from "./LessonPath";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

export interface FlowBlockResult {
  kind: FlowActivity["kind"];
  /** Phrase de récap du bloc accompli (« 12 révisions faites », « Histoire lue »…). */
  recap?: string;
  /** Contenu riche optionnel (delta de la relecture-miroir, phase F). */
  extra?: ReactNode;
}

interface Props {
  result: FlowBlockResult | null;
  next: FlowActivity;
  /** Ce que demande l'activité suivante (« 8 exercices · ~3 min »). */
  estimate?: string;
  /** Leçon en cours : ses stations, pour voir le chemin parcouru. */
  lesson?: Lesson;
  onContinue: () => void;
  onExit: () => void;
}

/**
 * Checkpoint du parcours — seulement quand il a quelque chose à montrer (le bilan d'une
 * relecture-miroir) ou plus rien à proposer ; sinon les blocs s'enchaînent directement,
 * chacun ayant son propre écran de fin. Bref récap, UNE seule suggestion pour
 * continuer, et une sortie toujours disponible — la séance n'a pas de fin imposée, on
 * s'arrête quand on veut (SPEC §5.1).
 */
export function FlowCheckpoint({ result, next, estimate, lesson, onContinue, onExit }: Props) {
  const done = next.kind === "done";
  return (
    <div className="flex flex-col gap-4">
      {result?.recap && (
        <Card className="flex flex-col gap-1 py-4">
          <SectionLabel>Étape accomplie</SectionLabel>
          <p className="m-0 font-serif text-lg text-text">{result.recap}</p>
        </Card>
      )}
      {result?.extra}
      {lesson && <LessonPath lesson={lesson} />}
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted">
          {next.reason}
          {/* Une étape de la leçon a déjà son estimation sous les stations. */}
          {estimate && !done && !(lesson && next.step) ? ` (${estimate})` : ""}
        </p>
        <div className="flex flex-wrap gap-3">
          {!done && (
            <Button variant="primary" onClick={onContinue}>
              Continuer avec : {next.title}
            </Button>
          )}
          <Button variant={done ? "primary" : "ghost"} onClick={onExit}>
            Arrêter ici
          </Button>
        </div>
      </div>
    </div>
  );
}
