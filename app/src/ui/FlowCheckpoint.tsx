import type { ReactNode } from "react";
import type { FlowActivity } from "../lib/flow";
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
  onContinue: () => void;
  onExit: () => void;
}

/**
 * Checkpoint du flux : bref récap du bloc accompli, UNE seule suggestion pour continuer,
 * et une sortie toujours disponible — le point de sortie naturel toutes les ~5 minutes.
 */
export function FlowCheckpoint({ result, next, onContinue, onExit }: Props) {
  const done = next.kind === "done";
  return (
    <div className="flex flex-col gap-4">
      {result?.recap && (
        <Card className="flex flex-col gap-1 py-4">
          <SectionLabel>Bloc accompli</SectionLabel>
          <p className="m-0 font-serif text-lg text-text">{result.recap}</p>
        </Card>
      )}
      {result?.extra}
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-muted">{next.reason}</p>
        <div className="flex flex-wrap gap-3">
          {!done && (
            <Button variant="primary" onClick={onContinue}>
              Continuer avec : {next.title}
            </Button>
          )}
          <Button variant={done ? "primary" : "ghost"} onClick={onExit}>
            Terminer pour aujourd'hui
          </Button>
        </div>
      </div>
    </div>
  );
}
