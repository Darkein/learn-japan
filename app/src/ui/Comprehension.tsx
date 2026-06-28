import { useEffect, useState } from "react";
import type { ComprehensionQuestion, GenState } from "../lib/genClient";
import { applyComprehension } from "../lib/quizSrs";
import { ensureComprehensionQuiz } from "../lib/stories";

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "…",
};

interface Props {
  /** Identifiant de l'histoire en base (cache le QCM). Absent pour une lecture libre. */
  storyId?: string;
  text: string;
  level: number;
  /** Points de grammaire de la leçon (mêmes index pour ids/labels) ; absent hors leçon. */
  grammar?: { ids: string[]; labels: string[] };
  onClose: () => void;
}

/**
 * QCM de compréhension (LLM) : vérifie qu'on a compris le SENS de l'histoire. Chaque
 * question est taguée d'un point de grammaire ; une réponse note ce point sur la piste
 * « compréhension » (SRS). Hors leçon (pas de grammaire cible), reste purement formatif.
 */
export function Comprehension({ storyId, text, level, grammar, onClose }: Props) {
  const [questions, setQuestions] = useState<ComprehensionQuestion[] | null>(null);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGenState("queued");
    ensureComprehensionQuiz(storyId, text, level, grammar ?? { ids: [], labels: [] }, (s) => {
      if (!cancelled) setGenState(s);
    })
      .then((qs) => {
        if (cancelled) return;
        setQuestions(qs);
        if (qs.length === 0) setError("QCM indisponible pour cette histoire.");
      })
      .catch((e) => {
        if (cancelled) return;
        setGenState("error");
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Régénère si l'histoire change ; les autres props sont stables pour une histoire donnée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, text]);

  const card = "flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6";

  if (error) {
    return (
      <div className={card}>
        <p className="text-sm text-accent">{error}</p>
        <button
          className="cursor-pointer self-start rounded-sm border border-hairline px-4 py-2 text-text"
          onClick={onClose}
        >
          Fermer
        </button>
      </div>
    );
  }

  if (!questions) {
    return (
      <div className={card}>
        <p className="text-sm text-muted">
          Préparation du QCM de compréhension… {genState ? STATE_LABEL[genState] : ""}
        </p>
      </div>
    );
  }

  if (i >= questions.length) {
    const graded = grammar && grammar.ids.length > 0;
    return (
      <div className={card}>
        <p className="text-lg">
          Compréhension — {score}/{questions.length} réussis.
          {graded ? " Les résultats ont nourri le SRS." : ""}
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
    setPicked(null);
    setI((n) => n + 1);
  }

  async function pick(choice: number) {
    if (picked !== null) return;
    setPicked(choice);
    const correct = choice === q.answerIndex;
    if (correct) setScore((s) => s + 1);
    // Notation SRS par point de grammaire (piste « compréhension »), si la question en cible un.
    if (q.targetGrammarId) await applyComprehension(q.targetGrammarId, correct);
  }

  return (
    <div className={card}>
      <span className="text-xs uppercase tracking-wider text-muted">
        Compréhension · question {i + 1} / {questions.length}
      </span>
      <p className="text-lg text-text">{q.question}</p>

      <div className="flex flex-col gap-2">
        {q.options.map((opt, idx) => {
          const isAnswer = idx === q.answerIndex;
          const cls =
            picked === null
              ? ""
              : isAnswer
                ? "border-accent-2 text-accent-2"
                : picked === idx
                  ? "border-accent text-accent"
                  : "opacity-60";
          return (
            <button
              key={idx}
              className={`cursor-pointer rounded-sm border border-hairline p-3 text-left text-text transition-colors hover:border-accent disabled:cursor-default ${cls}`}
              onClick={() => void pick(idx)}
              disabled={picked !== null}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <>
          <span className="text-sm text-muted">
            {picked === q.answerIndex ? "Correct." : `Réponse : ${q.options[q.answerIndex]}`}
          </span>
          <button
            className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white"
            onClick={next}
          >
            {i + 1 < questions.length ? "Suivant" : "Voir le score"}
          </button>
        </>
      )}
    </div>
  );
}
