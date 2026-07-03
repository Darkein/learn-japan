import { useEffect, useRef, useState } from "react";
import { toHiragana } from "wanakana";
import { translateExampleFr, type TypeExercise } from "../../lib/exercise";
import { normalizeReading } from "../../lib/kana";
import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";
import { SentenceFeedback } from "./SentenceFeedback";

interface Props {
  exercise: TypeExercise;
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
  /** Conversion romaji→kana pendant la saisie. */
  romaji: boolean;
  onRomajiChange?: (v: boolean) => void;
}

/** Saisie texte : l'utilisateur tape la réponse, s'auto-évalue Bien/Facile si correcte. */
export function TypeInput({ exercise: ex, onGraded, onNext, romaji, onRomajiChange }: Props) {
  const [entry, setEntry] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (correct === null) inputRef.current?.focus();
  }, [correct]);

  function checkType() {
    setCorrect(ex.answers.includes(normalizeReading(toHiragana(entry))));
  }

  return (
    <>
      <div className="font-jp text-3xl">{ex.front}</div>
      {correct === null ? (
        <>
          {ex.prompt && <span className="text-sm text-muted">{ex.prompt}</span>}
          <div className="relative w-full max-w-xs">
            <input
              ref={inputRef}
              className="w-full rounded-sm border border-hairline bg-bg px-3 py-2 text-center font-jp text-xl text-text outline-none focus:border-accent"
              value={entry}
              onChange={(e) => {
                const v = romaji
                  ? toHiragana(e.target.value, { IMEMode: "toHiragana" })
                  : e.target.value;
                setEntry(v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && entry.trim()) checkType();
              }}
              lang="ja"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label={ex.prompt ?? "Réponse"}
            />
            <button
              className="absolute right-2 top-1/2 min-h-9 min-w-9 -translate-y-1/2 cursor-pointer rounded-sm px-1 text-xs text-muted transition-colors hover:text-text"
              onClick={() => {
                onRomajiChange?.(!romaji);
                inputRef.current?.focus();
              }}
              title={romaji ? "Romaji → kana activé" : "Romaji → kana désactivé"}
              tabIndex={-1}
            >
              {romaji ? "あ" : "A"}
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={checkType} disabled={!entry.trim()}>
              Vérifier
            </Button>
            <Button variant="ghost" onClick={() => setCorrect(false)}>
              Je ne sais pas
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className={`text-sm ${correct ? "text-accent-2" : "text-accent"}`}>
            {correct ? "✓ Correct" : "✗ Raté"}
          </div>
          {!correct && entry.trim() && (
            <div className="text-sm text-accent">
              Ta réponse : <span className="font-jp">{entry}</span>
            </div>
          )}
          <div className="font-jp text-xl text-muted">{ex.back}</div>
          {ex.context && (
            <SentenceFeedback
              ja={ex.context}
              fr={ex.contextFr}
              onTranslate={() => translateExampleFr(ex.context!, ex)}
            />
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {correct ? (
              <>
                <Button
                  variant="ghost"
                  className="grow basis-24"
                  onClick={() => {
                    onGraded("good");
                    onNext();
                  }}
                >
                  Bien
                </Button>
                <Button
                  variant="ghost"
                  className="grow basis-24"
                  onClick={() => {
                    onGraded("easy");
                    onNext();
                  }}
                >
                  Facile
                </Button>
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
          </div>
        </>
      )}
    </>
  );
}
