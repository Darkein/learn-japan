import { useMemo, useState } from "react";
import { buildQuiz, type QuizQuestion } from "../lib/quiz";
import { applyKanji, applyParticle } from "../lib/quizSrs";
import type { SrsGrade } from "../lib/srs";
import type { KuromojiToken } from "../lib/tokenizer";
import styles from "./Quiz.module.css";

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
      <div className={styles.panel}>
        <p className={styles.feedback}>Pas de question générable pour ce texte.</p>
        <button className={`${styles.btn} ${styles.ghost}`} onClick={onClose}>
          Fermer
        </button>
      </div>
    );
  }

  if (i >= questions.length) {
    return (
      <div className={styles.panel}>
        <p className={styles.summary}>
          Quiz terminé — {score}/{questions.length} réussis. Les résultats ont nourri le SRS.
        </p>
        <button className={styles.btn} onClick={onClose}>
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
    <div className={styles.panel}>
      <span className={styles.progress}>
        Question {i + 1} / {questions.length}
      </span>

      {q.kind === "kanji-reading" ? (
        <>
          <div className={styles.prompt}>
            {q.surface} {revealed && <span className={styles.reading}>（{q.reading}）</span>}
          </div>
          {!revealed ? (
            <button className={styles.btn} onClick={() => setRevealed(true)}>
              Révéler la lecture
            </button>
          ) : (
            <>
              <span className={styles.feedback}>À quel point la connaissais-tu ?</span>
              <div className={styles.grades}>
                {GRADES.map((g) => (
                  <button key={g.id} className={styles.grade} onClick={() => gradeKanji(q, g.id)}>
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className={styles.prompt}>
            {q.before}
            <span className={styles.blank}>{picked ?? "◯"}</span>
            {q.after}
          </div>
          <div className={styles.choices}>
            {q.choices.map((c) => {
              const cls =
                picked && c === q.answer
                  ? styles.correct
                  : picked === c && c !== q.answer
                    ? styles.wrong
                    : "";
              return (
                <button
                  key={c}
                  className={`${styles.choice} ${cls}`}
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
              <span className={styles.feedback}>
                {picked === q.answer ? "Correct." : `Réponse : ${q.answer}`}
              </span>
              <button className={styles.btn} onClick={next}>
                Suivant
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
