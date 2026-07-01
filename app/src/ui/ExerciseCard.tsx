import { useEffect, useMemo, useRef, useState } from "react";
import { toHiragana } from "wanakana";
import { isCorrectOrder, shuffleTiles, type Tile } from "../lib/builder";
import type { Exercise } from "../lib/exercise";
import { normalizeReading } from "../lib/kana";
import type { SrsGrade } from "../lib/srs";
import { speakWord } from "../lib/tts";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";

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
 * remonter (`key={exercise.key}`) à chaque nouvel exercice.
 */
export function ExerciseCard({
  exercise: ex,
  onGraded,
  onNext,
  romaji = true,
  onRomajiChange,
}: Props) {
  const [listened, setListened] = useState(false);
  const [entry, setEntry] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [placed, setPlaced] = useState<Tile[]>([]);
  const [checked, setChecked] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const shuffled = useMemo(
    () => (ex.mode === "build" ? shuffleTiles(ex.target) : []),
    [ex],
  );

  const showInput = !ex.audio || listened;

  useEffect(() => {
    if (ex.mode === "type" && showInput && correct === null) inputRef.current?.focus();
  }, [ex, showInput, correct]);

  function handleListen() {
    speakWord(ex.audio!.word);
    setListened(true);
  }

  function checkType() {
    if (ex.mode !== "type") return;
    setCorrect(ex.answers.includes(normalizeReading(toHiragana(entry))));
  }

  function pickChoice(idx: number) {
    if (ex.mode !== "choice" || picked !== null) return;
    setPicked(idx);
    onGraded(idx === ex.answerIndex ? "good" : "again");
  }

  const placedKeys = new Set(placed.map((t) => t.key));
  function place(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => [...p, tile]);
  }
  function unplace(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => p.filter((t) => t.key !== tile.key));
  }
  function checkBuild() {
    if (ex.mode !== "build") return;
    const ok = isCorrectOrder(placed.map((t) => t.tile), ex.target);
    setChecked(ok);
    onGraded(ok ? "good" : "again");
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-12 text-center">
      {ex.isLeech && <Badge className="mb-1">Élément difficile</Badge>}

      {ex.audio && !listened ? (
        <>
          <div className="font-jp text-3xl">{ex.front}</div>
          <Button variant="primary" onClick={handleListen}>
            ▶ Écouter
          </Button>
        </>
      ) : ex.mode === "choice" ? (
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
              <span className="text-sm text-muted">
                {picked === ex.answerIndex ? "Correct." : `Réponse : ${ex.back}`}
              </span>
              <Button variant="primary" onClick={onNext}>
                Suivant
              </Button>
            </>
          )}
        </>
      ) : ex.mode === "build" ? (
        <>
          {ex.front && <p className="text-text">{ex.front}</p>}
          <div className="flex min-h-12 w-full flex-wrap items-center justify-center gap-2 rounded-sm border border-dashed border-hairline p-2">
            {placed.length === 0 && <span className="text-sm text-muted">Compose la phrase…</span>}
            {placed.map((t) => (
              <button
                key={t.key}
                className="min-h-11 cursor-pointer rounded-sm border border-accent bg-bg px-3 py-1.5 font-jp text-lg text-text disabled:cursor-default"
                onClick={() => unplace(t)}
                disabled={checked !== null}
              >
                {t.tile}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {shuffled.map((t) => (
              <button
                key={t.key}
                className="min-h-11 cursor-pointer rounded-sm border border-hairline bg-bg px-3 py-1.5 font-jp text-lg text-text transition-colors hover:border-accent disabled:opacity-30"
                onClick={() => place(t)}
                disabled={placedKeys.has(t.key) || checked !== null}
              >
                {t.tile}
              </button>
            ))}
          </div>
          {checked === null ? (
            <Button variant="primary" onClick={checkBuild} disabled={placed.length === 0}>
              Vérifier
            </Button>
          ) : (
            <>
              <div className={`text-sm ${checked ? "text-accent-2" : "text-accent"}`}>
                {checked ? "✓ Correct" : `✗ Ordre attendu : ${ex.target.join(" ")}`}
              </div>
              <Button variant="primary" onClick={onNext}>
                Suivant
              </Button>
            </>
          )}
        </>
      ) : (
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
              <div className="font-jp text-xl text-muted">{ex.back}</div>
              {ex.context && (
                <p className="mt-2 text-sm text-muted italic font-jp">{ex.context}</p>
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
      )}
    </div>
  );
}

