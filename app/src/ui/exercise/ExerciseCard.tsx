import { useEffect, useRef, useState } from "react";
import type { Exercise } from "../../lib/exercise";
import type { SrsGrade } from "../../lib/srs";
import { speakWord, stopSentence } from "../../lib/tts";
import { Badge } from "../kit/Badge";
import { Button } from "../kit/Button";
import { IconPlay } from "../kit/Icon";
import { BuildInput } from "./BuildInput";
import { ChoiceInput } from "./ChoiceInput";
import { JpFront } from "./JpFront";
import { TypeInput } from "./TypeInput";

interface Props {
  exercise: Exercise;
  /** Appelé dès que la réponse est connue, avec la note retenue (persiste le SRS). */
  onGraded: (grade: SrsGrade) => void;
  /** Appelé quand l'utilisateur passe à l'exercice suivant (pagination, pas de notation). */
  onNext: () => void;
  /** Conversion romaji→kana (mode "type"). Sans objet pour les autres modes. */
  romaji?: boolean;
  onRomajiChange?: (v: boolean) => void;
}

/**
 * Rendu d'UN exercice (QCM tap, saisie texte, ou construction de phrase) — toujours un
 * input, jamais d'auto-note aveugle. Composant sans état de session : le parent doit le
 * remonter (`key={exercise.key}`) à chaque nouvel exercice. Chaque mode porte son propre
 * état de réponse (TypeInput / ChoiceInput / BuildInput) ; ce shell gère le cadre commun
 * (badge « difficile », porte d'écoute audio préalable).
 */
export function ExerciseCard({
  exercise: ex,
  onGraded,
  onNext,
  romaji = true,
  onRomajiChange,
}: Props) {
  const [listened, setListened] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakToken = useRef(0);
  // Échappatoire des exercices d'écoute : révèle la phrase (audio cassé, hors-ligne
  // sans cache…) — l'exercice reste faisable, jamais de cul-de-sac. Couvre l'aveugle
  // (audioOnly) et les fronts masqués (◯◯) dont la phrase complète est dans `context`.
  const [textRevealed, setTextRevealed] = useState(false);
  const canReveal = !!ex.context && (!!ex.audioOnly || ex.context !== ex.front);

  // Carte suivante / démontage : coupe la synthèse vocale en cours (sinon l'utterance
  // orpheline peut laisser le focus audio OS actif et le ducking du volume système
  // jusqu'à la fermeture du navigateur — cf. stopSentence dans SentenceFeedback).
  useEffect(() => () => stopSentence(), []);

  async function handleListen() {
    setListened(true);
    // Jeton par appel : un rejeu pendant la lecture n'éteint pas l'indicateur de l'ancien
    // appel (coupé par le nouveau) — seul le dernier appel pilote `speaking`.
    const my = ++speakToken.current;
    setSpeaking(true);
    try {
      if (ex.audio?.sentence) await speakWord(ex.audio.sentence);
      else if (ex.audio?.word) await speakWord(ex.audio.word);
    } finally {
      if (speakToken.current === my) setSpeaking(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-12 text-center">
      {ex.isLeech && <Badge className="mb-1">Élément difficile</Badge>}

      {ex.audio && !listened ? (
        <>
          {ex.audioOnly ? (
            <div className="text-lg text-muted">🔊 Écoute la phrase…</div>
          ) : (
            <JpFront text={ex.front} className="font-jp text-3xl" />
          )}
          <Button variant="primary" onClick={() => void handleListen()}>
            <IconPlay size={16} />
            {speaking ? "Lecture…" : "Écouter"}
          </Button>
          {canReveal && (
            <button
              className="cursor-pointer text-xs text-muted underline"
              onClick={() => {
                setTextRevealed(true);
                setListened(true);
              }}
            >
              Je ne peux pas écouter — afficher le texte
            </button>
          )}
        </>
      ) : (
        <>
          {ex.audio && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="ghost" onClick={() => void handleListen()} active={speaking}>
                <IconPlay size={14} />
                {speaking ? "Lecture…" : "Réécouter"}
              </Button>
              {canReveal && !textRevealed && (
                <Button variant="ghost" onClick={() => setTextRevealed(true)}>
                  Afficher le texte
                </Button>
              )}
            </div>
          )}
          {canReveal && textRevealed && <div className="font-jp text-xl">{ex.context}</div>}
          {ex.mode === "choice" ? (
            <ChoiceInput exercise={ex} onGraded={onGraded} onNext={onNext} />
          ) : ex.mode === "build" ? (
            <BuildInput exercise={ex} onGraded={onGraded} onNext={onNext} />
          ) : (
            <TypeInput
              exercise={ex}
              onGraded={onGraded}
              onNext={onNext}
              romaji={romaji}
              onRomajiChange={onRomajiChange}
            />
          )}
        </>
      )}
    </div>
  );
}
