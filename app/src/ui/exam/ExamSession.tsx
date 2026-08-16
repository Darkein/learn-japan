import { useEffect, useMemo, useState } from "react";
import { EXAM, SRS } from "../../lib/config";
import {
  examStatus,
  prepareExam,
  submitExam,
  type Exam,
  type ExamAnswers,
  type ExamResult,
  type ExamStatus,
} from "../../lib/exam";
import { generateExamText } from "../../lib/genClient";
import { getLesson, type Lesson } from "../../lib/lessons";
import { isSilentMode, loadSettings } from "../../lib/settings";
import { tokenize } from "../../lib/tokenizer";
import { Badge } from "../kit/Badge";
import { Button } from "../kit/Button";
import { Card } from "../kit/Card";
import { LoadingScreen } from "../kit/LoadingScreen";
import { SectionLabel } from "../kit/SectionLabel";
import { useSettings } from "../useSettings";
import { ExamQuestionCard } from "./ExamQuestionCard";
import { ExamReport } from "./ExamReport";

interface Props {
  lessonId: string;
  onExit: () => void;
  /** Ouvre une session de révision (rattrapage : repasser les items ratés). */
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
}

type Phase = "cover" | "running" | "report";

/**
 * Le contrôle de fin de leçon (le 関所). Trois temps, comme une épreuve : l'en-tête de
 * copie (règles + barème), le sujet (une question à la fois, sans aucune correction), la
 * copie corrigée. Rien n'est noté avant la remise : on peut revenir sur ses réponses.
 */
export function ExamSession({ lessonId, onExit, onStartReview }: Props) {
  const { settings, update } = useSettings();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [exam, setExam] = useState<Exam | null>(null);
  const [phase, setPhase] = useState<Phase>("cover");
  const [answers, setAnswers] = useState<ExamAnswers>({});
  const [listens, setListens] = useState<Record<string, number>>({});
  const [i, setI] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExamResult | null>(null);

  useEffect(() => {
    void (async () => {
      const [l, st] = await Promise.all([getLesson(lessonId), examStatus(lessonId)]);
      setLesson(l ?? null);
      setStatus(st);
    })();
  }, [lessonId]);

  /** Questions à plat, dans l'ordre du sujet (la pagination est linéaire, comme une copie). */
  const questions = useMemo(
    () => (exam ? exam.sections.flatMap((s) => s.questions) : []),
    [exam],
  );
  const current = questions[i];
  const section = exam?.sections.find((s) => s.questions.some((q) => q.key === current?.key));
  const blanks = questions.filter((q) => {
    const a = answers[q.key];
    return a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0);
  }).length;

  async function start() {
    if (!lesson || !status) return;
    setBusy(true);
    try {
      const attempt = status.nextAttempt;
      const built = await prepareExam(
        {
          lessonId: lesson.id,
          level: lesson.level,
          vocabIds: lesson.introduces.vocab,
          grammarIds: lesson.introduces.grammar,
        },
        attempt,
        {
          tokenize,
          // Seule partie du sujet qui passe par le Worker. Indisponible (hors-ligne,
          // panne) ⇒ section retirée, barème ramené : le contrôle n'est jamais bloqué.
          comprehension: async () =>
            (await generateExamText(
              {
                lessonId: lesson.id,
                title: lesson.title,
                level: lesson.level,
                vocab: lesson.objectives.vocab,
                grammar: { ids: lesson.introduces.grammar, labels: lesson.objectives.grammar },
              },
              attempt,
            )) ?? undefined,
          silent: isSilentMode(loadSettings()),
        },
      );
      setExam(built);
      setAnswers({});
      setListens({});
      setI(0);
      setStartedAt(Date.now());
      setPhase("running");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!exam) return;
    setBusy(true);
    try {
      setResult(await submitExam(exam, answers, startedAt));
      setPhase("report");
    } finally {
      setBusy(false);
    }
  }

  if (!lesson || !status) return <LoadingScreen />;

  if (phase === "report" && result) {
    return (
      <ExamReport
        lesson={lesson}
        result={result}
        onExit={onExit}
        onStartReview={onStartReview}
      />
    );
  }

  if (phase === "cover" || !exam || !current) {
    return (
      <ExamCover
        lesson={lesson}
        status={status}
        busy={busy}
        onStart={() => void start()}
        onExit={onExit}
        onStartReview={onStartReview}
      />
    );
  }

  const listensLeft = EXAM.listens - (listens[current.key] ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>{section?.title}</SectionLabel>
        <span className="text-xs text-muted">
          Question {i + 1} / {questions.length} · {current.points} pt
          {current.points > 1 ? "s" : ""}
        </span>
      </div>
      {section && i === questions.findIndex((q) => q.key === section.questions[0].key) && (
        <p className="m-0 text-sm text-muted">{section.instruction}</p>
      )}
      {section?.preamble && (
        <Card className="font-jp text-lg leading-relaxed text-text">{section.preamble}</Card>
      )}

      <Card className="py-6">
        <ExamQuestionCard
          key={current.key}
          question={current}
          answer={answers[current.key] ?? null}
          onAnswer={(a) => setAnswers((prev) => ({ ...prev, [current.key]: a }))}
          listensLeft={listensLeft}
          onListen={() =>
            setListens((prev) => ({ ...prev, [current.key]: (prev[current.key] ?? 0) + 1 }))
          }
          romaji={settings.warmupRomaji}
          onRomajiChange={(v) => update({ warmupRomaji: v })}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="quiet" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
          ← Précédente
        </Button>
        {i < questions.length - 1 ? (
          <Button variant="primary" onClick={() => setI((n) => n + 1)}>
            Suivante →
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Correction…" : "Rendre la copie"}
          </Button>
        )}
      </div>

      {/* Rendre la copie reste possible à tout moment — c'est une épreuve, pas un couloir. */}
      {i < questions.length - 1 && (
        <button
          className="cursor-pointer self-center text-sm text-muted underline"
          onClick={() => void submit()}
          disabled={busy}
        >
          Rendre la copie maintenant{blanks > 0 ? ` (${blanks} sans réponse)` : ""}
        </button>
      )}
      <p className="m-0 text-center text-xs text-muted">
        Aucune correction avant la remise de la copie — tu peux revenir sur tes réponses.
      </p>
    </div>
  );
}

/** En-tête de copie : ce qui est attendu, le barème, et l'état du droit à se présenter. */
function ExamCover({
  lesson,
  status,
  busy,
  onStart,
  onExit,
  onStartReview,
}: {
  lesson: Lesson;
  status: ExamStatus;
  busy: boolean;
  onStart: () => void;
  onExit: () => void;
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
}) {
  const eligible = lesson.unlockProgress >= SRS.examEligibility;
  const ready = eligible && status.retakeReady;
  const last = status.records[0];
  // Contrôle déjà franchi : on repasse pour la note, jamais pour le droit de passer —
  // une copie ratée derrière une admission ne referme rien (cf. lib/lessons.ts).
  const alreadyPassed = status.passed;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <SectionLabel>関所 — poste de contrôle</SectionLabel>
        <h2 className="m-0 font-serif text-2xl text-text">Contrôle — {lesson.title}</h2>
        <p className="m-0 text-sm text-muted">
          {alreadyPassed
            ? `Barrière déjà franchie${status.bestNote != null ? ` (${status.bestNote}/20)` : ""} — tu repasses pour la note : seule la meilleure compte, et un échec ne referme rien.`
            : `Franchir la barrière ouvre la leçon suivante. Admission à ${EXAM.passMark}/20.`}
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <SectionLabel as="p">Déroulement</SectionLabel>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-text">
          <li>
            · Six exercices au plus, une question à la fois — l'ordre est libre, on peut
            revenir sur ses réponses.
          </li>
          <li>· Aucune correction pendant l'épreuve : la copie est corrigée à la remise.</li>
          <li>· Pas de furigana, pas de gloss, pas de traduction — {EXAM.listens} écoutes en dictée.</li>
          <li>· Une coquille vaut la moitié des points ; une réponse fausse ramène l'item en révision.</li>
          <li>
            · Note sur 20 : un exercice sans matière (hors-ligne, écoute en pause) est retiré du
            barème plutôt que compté faux.
          </li>
        </ul>
      </Card>

      {status.attempts > 0 && (
        <Card className="flex flex-col gap-2">
          <SectionLabel as="p">Copies précédentes</SectionLabel>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {status.records.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3">
                <span className="text-muted">Tentative {r.attempt}</span>
                <span className="text-text">
                  {r.note}/20 — {r.mention}
                </span>
                <Badge variant={r.passed ? "accent" : "default"}>{r.passed ? "admis" : "ajourné"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!eligible ? (
        <Card className="flex flex-col gap-2" accentFlag>
          <p className="m-0 text-sm text-text">
            Le contrôle n'est pas encore ouvert : la leçon doit être travaillée avant d'être
            évaluée ({Math.round(lesson.unlockProgress * 100)} % des éléments stabilisés, il en
            faut {Math.round(SRS.examEligibility * 100)} %).
          </p>
          {onStartReview && (
            <Button onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}>
              S'entraîner sur la leçon
            </Button>
          )}
        </Card>
      ) : !status.retakeReady && !alreadyPassed ? (
        <Card className="flex flex-col gap-2" accentFlag>
          <p className="m-0 text-sm text-text">
            Rattrapage : il reste {status.pendingItems.length} élément
            {status.pendingItems.length > 1 ? "s" : ""} raté
            {status.pendingItems.length > 1 ? "s" : ""} à revoir depuis la dernière copie
            {last ? ` (${last.note}/20)` : ""}. Repasse-les en révision, le nouveau sujet
            s'ouvrira ensuite.
          </p>
          {onStartReview && (
            <Button onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}>
              Réviser les éléments ratés
            </Button>
          )}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={onStart} disabled={!ready || busy}>
          {busy
            ? "Préparation du sujet…"
            : alreadyPassed
              ? `Repasser le contrôle (sujet ${status.nextAttempt})`
              : status.attempts > 0
                ? `Passer le rattrapage (sujet ${status.nextAttempt})`
                : "Commencer l'épreuve"}
        </Button>
        <Button variant="quiet" onClick={onExit}>
          Retour
        </Button>
      </div>
    </div>
  );
}
