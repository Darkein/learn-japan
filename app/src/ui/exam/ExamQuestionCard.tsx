import { useEffect, useMemo, useRef, useState } from "react";
import { toHiragana } from "wanakana";
import { shuffleTiles, type Tile } from "../../lib/builder";
import { EXAM } from "../../lib/config";
import type { ExamAnswer, ExamQuestion } from "../../lib/exam";
import { speakWord, stopSentence } from "../../lib/tts";
import { Button } from "../kit/Button";
import { IconSpeaker } from "../kit/Icon";
import { JpFront } from "../exercise/JpFront";

interface Props {
  question: ExamQuestion;
  /** Réponse déjà donnée (l'élève peut revenir sur une question et la corriger). */
  answer: ExamAnswer;
  onAnswer: (a: ExamAnswer) => void;
  /** Écoutes restantes sur cette question (dictée) — décomptées par le parent. */
  listensLeft: number;
  onListen: () => void;
  romaji: boolean;
  onRomajiChange: (v: boolean) => void;
}

/**
 * UNE question de contrôle. À la différence d'`ExerciseCard` (révision), cette carte ne
 * corrige rien et ne révèle rien : pas de « Vérifier », pas de bonne réponse, pas de
 * boutons d'auto-notation, pas de sens ni de phrase d'exemple en secours. Elle collecte
 * une réponse, c'est tout — la correction vient à la remise de la copie.
 */
export function ExamQuestionCard({
  question,
  answer,
  onAnswer,
  listensLeft,
  onListen,
  romaji,
  onRomajiChange,
}: Props) {
  const ex = question.exercise;

  // Coupe la synthèse en quittant la question (cf. ExerciseCard) : une utterance orpheline
  // peut garder le focus audio de l'OS.
  useEffect(() => () => stopSentence(), []);

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {ex.audio && (
        <ListenButton
          audio={ex.audio}
          listensLeft={listensLeft}
          onListen={onListen}
        />
      )}
      {!ex.audioOnly && <JpFront text={ex.front} />}
      {ex.prompt && <p className="m-0 text-sm text-muted">{ex.prompt}</p>}

      {ex.mode === "choice" && (
        <ChoiceAnswer
          choices={ex.choices}
          picked={typeof answer === "number" ? answer : null}
          onPick={onAnswer}
        />
      )}
      {ex.mode === "type" && (
        <TypeAnswer
          value={typeof answer === "string" ? answer : ""}
          onChange={onAnswer}
          romaji={romaji}
          onRomajiChange={onRomajiChange}
        />
      )}
      {ex.mode === "build" && (
        <BuildAnswer
          target={ex.target}
          questionKey={question.key}
          placedSurfaces={Array.isArray(answer) ? answer : []}
          onChange={onAnswer}
        />
      )}
    </div>
  );
}

/** Écoute comptée : au-delà de `EXAM.listens`, on écrit ce qu'on a retenu. */
function ListenButton({
  audio,
  listensLeft,
  onListen,
}: {
  audio: { word?: string; sentence?: string };
  listensLeft: number;
  onListen: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const token = useRef(0);

  async function play() {
    if (listensLeft <= 0 || speaking) return;
    onListen();
    const my = ++token.current;
    setSpeaking(true);
    try {
      await speakWord(audio.sentence ?? audio.word ?? "");
    } finally {
      if (token.current === my) setSpeaking(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="ghost" onClick={() => void play()} disabled={listensLeft <= 0 || speaking}>
        <IconSpeaker size={18} />
        {speaking ? "Lecture…" : listensLeft > 0 ? "Écouter" : "Plus d'écoute"}
      </Button>
      <span className="text-xs text-muted">
        {listensLeft} écoute{listensLeft > 1 ? "s" : ""} restante{listensLeft > 1 ? "s" : ""} sur{" "}
        {EXAM.listens}
      </span>
    </div>
  );
}

function ChoiceAnswer({
  choices,
  picked,
  onPick,
}: {
  choices: string[];
  picked: number | null;
  onPick: (i: number) => void;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {choices.map((c, i) => (
        <button
          key={i}
          // Sélection, pas correction : la case cochée est mise en avant, sans dire si
          // elle est juste. On peut changer d'avis tant que la copie n'est pas rendue.
          className={`min-h-11 w-full cursor-pointer rounded-sm border bg-bg p-3 text-left font-jp text-lg transition-colors ${
            picked === i
              ? "border-accent text-accent"
              : "border-hairline-strong text-text hover:border-accent hover:bg-surface-2"
          }`}
          onClick={() => onPick(i)}
        >
          <span className="mr-2 font-sans text-xs text-muted">{"ABCD"[i]}</span>
          {c}
        </button>
      ))}
    </div>
  );
}

function TypeAnswer({
  value,
  onChange,
  romaji,
  onRomajiChange,
}: {
  value: string;
  onChange: (v: string) => void;
  romaji: boolean;
  onRomajiChange: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="relative w-full max-w-xs">
      <input
        ref={inputRef}
        className="w-full rounded-sm border border-hairline bg-bg px-3 py-2 text-center font-jp text-xl text-text outline-none focus:border-accent"
        value={value}
        onChange={(e) =>
          onChange(romaji ? toHiragana(e.target.value, { IMEMode: "toHiragana" }) : e.target.value)
        }
        lang="ja"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Réponse"
      />
      <button
        className="absolute right-2 top-1/2 min-h-9 min-w-9 -translate-y-1/2 cursor-pointer rounded-sm px-1 text-xs text-muted transition-colors hover:text-text"
        onClick={() => {
          onRomajiChange(!romaji);
          inputRef.current?.focus();
        }}
        title={romaji ? "Romaji → kana activé" : "Romaji → kana désactivé"}
        tabIndex={-1}
      >
        {romaji ? "あ" : "A"}
      </button>
    </div>
  );
}

/**
 * Tuiles à ordonner. La réponse stockée est la SUITE DE SURFACES (`string[]`) : en
 * revenant sur la question, on la reconstitue en réattribuant chaque surface à une tuile
 * encore libre — deux tuiles identiques (« は » et « は ») restent interchangeables.
 */
function BuildAnswer({
  target,
  questionKey,
  placedSurfaces,
  onChange,
}: {
  target: string[];
  questionKey: string;
  placedSurfaces: string[];
  onChange: (v: string[]) => void;
}) {
  const tiles = useMemo(() => shuffleTiles(target), [questionKey, target]);
  const placed = useMemo(() => {
    const free = [...tiles];
    const out: Tile[] = [];
    for (const surface of placedSurfaces) {
      const i = free.findIndex((t) => t.tile === surface);
      if (i >= 0) out.push(free.splice(i, 1)[0]);
    }
    return out;
  }, [tiles, placedSurfaces]);
  const placedKeys = new Set(placed.map((t) => t.key));

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex min-h-12 w-full flex-wrap items-center justify-center gap-2 rounded-sm border border-dashed border-hairline p-2">
        {placed.length === 0 && <span className="text-sm text-muted">Compose la phrase…</span>}
        {placed.map((t) => (
          <button
            key={t.key}
            className="min-h-11 cursor-pointer rounded-sm border border-accent bg-bg px-3 py-1.5 font-jp text-lg text-text"
            onClick={() => onChange(placed.filter((p) => p.key !== t.key).map((p) => p.tile))}
          >
            {t.tile}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {tiles.map((t) => (
          <button
            key={t.key}
            className="min-h-11 cursor-pointer rounded-sm border border-hairline-strong bg-bg px-3 py-1.5 font-jp text-lg text-text transition-colors hover:border-accent disabled:cursor-default disabled:border-hairline disabled:text-muted"
            onClick={() => onChange([...placed.map((p) => p.tile), t.tile])}
            disabled={placedKeys.has(t.key)}
          >
            {t.tile}
          </button>
        ))}
      </div>
    </div>
  );
}
