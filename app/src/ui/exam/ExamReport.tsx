import { EXAM } from "../../lib/config";
import type { ExamResult, QuestionResult } from "../../lib/exam";
import type { Lesson } from "../../lib/lessons";
import { Badge } from "../kit/Badge";
import { Button } from "../kit/Button";
import { Card } from "../kit/Card";
import { SectionLabel } from "../kit/SectionLabel";

interface Props {
  lesson: Lesson;
  result: ExamResult;
  onExit: () => void;
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
}

const VERDICT_MARK: Record<QuestionResult["verdict"], string> = {
  correct: "✓",
  almost: "≈",
  wrong: "✗",
};

/**
 * La copie corrigée : note, mention, barème par exercice, puis chaque question avec la
 * réponse donnée ET la réponse attendue. C'est ici — et seulement ici — que la correction
 * apparaît. Les réponses ont déjà été replanifiées en SRS par `submitExam` : une question
 * ratée revient d'elle-même dans les révisions.
 */
export function ExamReport({ lesson, result, onExit, onStartReview }: Props) {
  const missed = result.results.filter((r) => r.verdict !== "correct");
  // `lesson` a été chargée AVANT cette copie : elle dit donc si la barrière était déjà
  // franchie. Repasser un contrôle réussi ne peut pas le défaire — une copie ratée
  // derrière une admission ne referme pas la leçon suivante.
  const wasPassed = lesson.examPassed;
  const best = Math.max(result.note, lesson.examNote ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionLabel>関所 — copie corrigée</SectionLabel>
        <h2 className="m-0 font-serif text-2xl text-text">{lesson.title}</h2>
      </div>

      <Card accentFlag className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-serif text-5xl text-text">{result.note}</span>
          <span className="font-serif text-2xl text-muted">/ 20</span>
          <Badge variant={result.passed ? "accent" : "default"} className="uppercase tracking-wide">
            {result.passed ? "admis" : "ajourné"}
          </Badge>
        </div>
        <p className="m-0 text-sm text-text">{result.mention}</p>
        <p className="m-0 text-xs text-muted">
          {result.obtained} / {result.max} points au barème de ce sujet
          {result.max !== 20 ? " (sections indisponibles retirées du total)" : ""} — admission à{" "}
          {EXAM.passMark}/20.
        </p>
        <p className="m-0 text-sm text-text">
          {wasPassed
            ? `Barrière déjà franchie : elle le reste. Meilleure note conservée — ${best}/20.`
            : result.passed
              ? "Barrière franchie : la leçon suivante est ouverte."
              : "La barrière reste fermée. Les éléments ratés sont revenus en révision — le rattrapage s'ouvrira une fois qu'ils seront repassés."}
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <SectionLabel as="p">Barème</SectionLabel>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {result.sections.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3">
              <span className="text-text">{s.title}</span>
              <span className={s.obtained === s.max ? "text-accent-2" : "text-muted"}>
                {s.obtained} / {s.max}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel as="p">Détail des réponses</SectionLabel>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {result.results.map((r) => (
            <li key={r.key} className="flex flex-col gap-0.5 border-t border-hairline pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-text">
                  <span
                    className={`mr-2 ${r.verdict === "correct" ? "text-accent-2" : r.verdict === "almost" ? "text-text" : "text-accent"}`}
                  >
                    {VERDICT_MARK[r.verdict]}
                  </span>
                  {r.prompt}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {r.points} / {r.maxPoints}
                </span>
              </div>
              <span className="font-jp text-sm text-muted">
                Ta réponse : {r.given || <span className="font-sans italic">(blanc)</span>}
              </span>
              {r.verdict !== "correct" && (
                <span className="font-jp text-sm text-accent-2">Attendu : {r.expected}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onExit}>
          {result.passed || wasPassed ? "Continuer" : "Retour à la leçon"}
        </Button>
        {!result.passed && onStartReview && missed.length > 0 && (
          <Button onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}>
            Réviser maintenant ({missed.length})
          </Button>
        )}
      </div>
    </div>
  );
}
