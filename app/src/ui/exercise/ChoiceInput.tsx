import { useState } from "react";
import { clozeSentence, translateExampleFr, type ChoiceExercise } from "../../lib/exercise";
import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";
import { GradeButtons } from "./GradeButtons";
import { SentenceFeedback } from "./SentenceFeedback";

interface Props {
  exercise: ChoiceExercise;
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

/**
 * QCM tap : cloze inline (particule à compléter) ou question. La note est différée au
 * choix Bien/Facile (réponse correcte) ou Continuer (ratée) — comme TypeInput — au lieu de
 * toujours noter "good" : FSRS n'atteint l'état Review (compté pour le déblocage/la
 * maîtrise) qu'après deux révisions "good" espacées de 10 min, quand un "easy" y bascule
 * immédiatement.
 */
export function ChoiceInput({ exercise: ex, onGraded, onNext }: Props) {
  const [picked, setPicked] = useState<number | null>(null);

  function pickChoice(idx: number) {
    if (picked !== null) return;
    setPicked(idx);
  }

  return (
    <>
      {ex.cloze ? (
        <div className="font-jp text-2xl">
          {ex.cloze.before}
          <span className="border-b-2 border-accent px-2 text-accent">
            {picked !== null ? ex.choices[picked] : "◯"}
          </span>
          {ex.cloze.after}
        </div>
      ) : (
        <p className="text-lg text-text">{ex.front}</p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {ex.choices.map((c, idx) => {
          const cls =
            picked !== null && idx === ex.answerIndex
              ? "border-accent-2 text-accent-2"
              : picked === idx && idx !== ex.answerIndex
                ? "border-accent text-accent"
                : picked !== null
                  ? "opacity-60"
                  : "";
          return (
            <Button
              key={idx}
              variant="ghost"
              className={`grow basis-16 min-h-11 bg-bg p-3 font-jp text-lg disabled:cursor-default disabled:opacity-100 ${cls}`}
              onClick={() => pickChoice(idx)}
              disabled={picked !== null}
            >
              {c}
            </Button>
          );
        })}
      </div>
      {picked !== null && (
        <>
          {ex.cloze && (
            <SentenceFeedback
              ja={clozeSentence(ex.cloze, ex.choices[ex.answerIndex])}
              fr={ex.contextFr}
              onTranslate={() =>
                translateExampleFr(clozeSentence(ex.cloze!, ex.choices[ex.answerIndex]), ex)
              }
            />
          )}
          {picked === ex.answerIndex ? (
            <>
              <span className="text-sm text-accent-2">Correct.</span>
              <GradeButtons onGraded={onGraded} onNext={onNext} />
            </>
          ) : (
            <>
              <span className="text-sm text-muted">Réponse : {ex.back}</span>
              <Button
                variant="primary"
                onClick={() => {
                  onGraded("again");
                  onNext();
                }}
              >
                Continuer
              </Button>
            </>
          )}
        </>
      )}
    </>
  );
}
