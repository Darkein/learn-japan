import { useState } from "react";
import { translateExampleFr, type ChoiceExercise } from "../../lib/exercise";
import { hasJapanese } from "../../lib/kana";
import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";
import { GradeButtons } from "./GradeButtons";
import { JpFront } from "./JpFront";
import { AudioBackButton, SentenceFeedback } from "./SentenceFeedback";
import { WordFeedback } from "./WordFeedback";

interface Props {
  exercise: ChoiceExercise;
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

/** Au-delà, une option n'est plus une forme à reconnaître mais un texte à lire. */
const TILE_MAX = 8;

/**
 * Options courtes et japonaises (graphies, lectures) : on compare des FORMES, elles
 * méritent une grille de grandes tuiles. Des règles de grammaire ou des sens français
 * restent en liste — les mettre en tuiles carrées ne ferait que tronquer le texte.
 */
function isTileGrid(choices: string[]): boolean {
  return choices.every((c) => hasJapanese(c) && [...c].length <= TILE_MAX);
}

/**
 * QCM tap. La note est différée au choix Bien/Facile (réponse correcte) ou Continuer
 * (ratée) — comme TypeInput — au lieu de toujours noter "good" : FSRS n'atteint l'état
 * Review (compté pour le déblocage/la maîtrise) qu'après deux révisions "good" espacées de
 * 10 min, quand un "easy" y bascule immédiatement.
 */
export function ChoiceInput({ exercise: ex, onGraded, onNext }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const tiles = isTileGrid(ex.choices);

  function pickChoice(idx: number) {
    if (picked !== null) return;
    setPicked(idx);
  }

  return (
    <>
      <JpFront text={ex.front} />
      {ex.prompt && <span className="text-sm text-muted">{ex.prompt}</span>}
      <div
        className={
          tiles
            ? "grid w-full max-w-sm grid-cols-2 gap-3"
            : "flex flex-wrap justify-center gap-3"
        }
      >
        {ex.choices.map((c, idx) => {
          // État après réponse. Les couleurs sont posées ici plutôt que via `Button` :
          // `variant="ghost"` fixe déjà `border-hairline-strong`/`text-text`, utilitaires
          // de même spécificité — l'ordre de la feuille Tailwind décidait du gagnant et
          // la bonne réponse restait grise.
          const state =
            picked === null
              ? "border-hairline-strong text-text hover:border-accent hover:bg-surface-2"
              : idx === ex.answerIndex
                ? "border-accent-2 text-accent-2"
                : idx === picked
                  ? "border-accent text-accent"
                  : "border-hairline text-muted";
          const size = tiles ? "min-h-24 font-jp text-3xl" : "grow basis-16 min-h-11 font-jp text-lg";
          return (
            <button
              key={idx}
              className={`inline-flex items-center justify-center rounded-sm border bg-bg p-3 transition-colors ${size} ${state} ${picked === null ? "cursor-pointer" : "cursor-default"}`}
              onClick={() => pickChoice(idx)}
              disabled={picked !== null}
            >
              {c}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <>
          {ex.word ? (
            <WordFeedback word={ex.word} />
          ) : (
            picked !== ex.answerIndex && (
              <span className="text-sm text-muted">Réponse : {ex.back}</span>
            )
          )}
          {ex.meaning && ex.meaning !== ex.front && (
            <span className="text-sm text-text">
              <span className="text-muted">Sens : </span>
              {ex.meaning}
            </span>
          )}
          {ex.context && (
            <SentenceFeedback
              ja={ex.context}
              fr={ex.contextFr}
              onTranslate={() => translateExampleFr(ex.context!, ex)}
            />
          )}
          {ex.audioBack && (
            <AudioBackButton audio={ex.audioBack} label={ex.context ? "Écouter le mot" : "Écouter"} />
          )}
          {picked === ex.answerIndex ? (
            <>
              <span className="text-sm text-accent-2">Correct.</span>
              <GradeButtons onGraded={onGraded} onNext={onNext} />
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                onGraded("again");
                onNext();
              }}
            >
              Continuer
            </Button>
          )}
        </>
      )}
    </>
  );
}
