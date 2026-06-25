import { useMemo, useState } from "react";
import { buildQuiz, type QuizQuestion } from "../lib/quiz";
import { applyKanji, applyParticle } from "../lib/quizSrs";
import type { SrsGrade } from "../lib/srs";
import type { KuromojiToken } from "../lib/tokenizer";

const GRADES: { id: SrsGrade; label: string }[] = [
  { id: "again", label: "Raté" },
  { id: "hard", label: "Difficile" },
  { id: "good", label: "Bien" },
  { id: "easy", label: "Facile" },
];

export function Quiz({ tokens, onClose }: { tokens: KuromojiToken[]; onClose: () => void }) {
  const questions = useMemo<QuizQuestion[]>(() => buildQuiz(tokens), [tokens]);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  if (questions.length === 0) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6">
        <p className="text-sm text-muted">Pas de question générable pour ce texte.</p>
        <button
          className="cursor-pointer self-start rounded-sm border border-hairline px-4 py-2 text-text"
          onClick={onClose}
        >
          Fermer
        </button>
      </div>
    );
  }

  if (i >= questions.length) {
    return (
      <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6">
        <p className="text-lg">
          Quiz terminé — {score}/{questions.length} réussis. Les résultats ont nourri le SRS.
        </p>
        <button
          className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white"
          onClick={onClose}
        >
          Terminer
        </button>
      </div>
    );
  }

  const q = questions[i];

  function next() {
    setRevealed(false);
    setPicked(null);
    setI((n) => n + 1);
  }

  async function gradeKanji(q: Extract<QuizQuestion, { kind: "kanji-reading" }>, g: SrsGrade) {
    await Promise.all(q.kanji.map((c) => applyKanji(c, g)));
    if (g === "good" || g === "easy") setScore((s) => s + 1);
    next();
  }

  async function pickParticle(q: Extract<QuizQuestion, { kind: "particle" }>, choice: string) {
    if (picked) return;
    setPicked(choice);
    const correct = choice === q.answer;
    if (correct) setScore((s) => s + 1);
    await applyParticle(q.answer, correct);
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6">
      <span className="text-xs uppercase tracking-wider text-muted">
        Question {i + 1} / {questions.length}
      </span>

      {q.kind === "kanji-reading" ? (
        <>
          <div className="font-jp text-2xl">
            {q.surface}{" "}
            {revealed && <span className="font-jp text-accent">（{q.reading}）</span>}
          </div>
          {!revealed ? (
            <button
              className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white"
              onClick={() => setRevealed(true)}
            >
              Révéler la lecture
            </button>
          ) : (
            <>
              <span className="text-sm text-muted">À quel point la connaissais-tu ?</span>
              <div className="flex flex-wrap gap-2">
                {GRADES.map((g) => (
                  <button
                    key={g.id}
                    className="grow basis-20 cursor-pointer rounded-sm border border-hairline p-2 text-sm text-text transition-colors hover:border-accent"
                    onClick={() => gradeKanji(q, g.id)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="font-jp text-2xl">
            {q.before}
            <span className="border-b-2 border-accent px-2 text-accent">{picked ?? "◯"}</span>
            {q.after}
          </div>
          <div className="flex flex-wrap gap-3">
            {q.choices.map((c) => {
              const cls =
                picked && c === q.answer
                  ? "border-accent-2 text-accent-2"
                  : picked === c && c !== q.answer
                    ? "border-accent text-accent"
                    : "";
              return (
                <button
                  key={c}
                  className={`grow basis-16 cursor-pointer rounded-sm border border-hairline bg-bg p-3 font-jp text-lg text-text transition-colors hover:border-accent ${cls}`}
                  onClick={() => pickParticle(q, c)}
                  disabled={!!picked}
                >
                  {c}
                </button>
              );
            })}
          </div>
          {picked && (
            <>
              <span className="text-sm text-muted">
                {picked === q.answer ? "Correct." : `Réponse : ${q.answer}`}
              </span>
              <button
                className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white"
                onClick={next}
              >
                Suivant
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
