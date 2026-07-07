import { useEffect, useState } from "react";
import type { Lesson } from "../lib/lessons";
import { markLessonStarted } from "../lib/lessons";
import { SRS } from "../lib/config";
import { GenProgress } from "./GenProgress";
import { useLessonGen } from "./useLessonGen";
import { Badge } from "./kit/Badge";
import { IconArrowRight, IconLock } from "./kit/Icon";
import { ProgressBar } from "./kit/ProgressBar";

interface Props {
  lesson: Lesson;
  /** Ouvre le cours (panneau latéral en split, page dédiée sinon). */
  onOpen: (lesson: Lesson) => void;
  /** Sélectionne la carte sans la déclencher (mode split). */
  selected?: boolean;
}

// Résumé compact des objectifs, ex. « 5 mots · 1 point de grammaire ».
function summarize(lesson: Lesson): string {
  const parts: string[] = [];
  const v = lesson.objectives.vocab.length;
  const g = lesson.objectives.grammar.length;
  if (v) parts.push(`${v} mot${v > 1 ? "s" : ""}`);
  if (g) parts.push(`${g} point${g > 1 ? "s" : ""} de grammaire`);
  return parts.join(" · ");
}

export function LessonCard({ lesson, onOpen, selected }: Props) {
  const { job, busy, error, progress, label, retry, dismiss } = useLessonGen(lesson);

  const ready = lesson.state === "ready";
  const available = ready || lesson.pregenerated;
  const summary = summarize(lesson);
  // Leçon en cours : c'est ELLE qui porte la jauge de déblocage (sa propre progression vers
  // le déblocage de la suivante). La leçon verrouillée juste en dessous n'a plus de barre —
  // elle répétait la même information (la progression de la leçon précédente).
  const inProgress = !!lesson.startedAt && !lesson.completedAt;

  const [gaugeWidth, setGaugeWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setGaugeWidth(Math.round(lesson.unlockProgress * 100)), 50);
    return () => clearTimeout(t);
  }, [lesson.unlockProgress]);

  return (
    <li
      className="flex flex-col gap-2 border-t border-hairline py-4 last:border-b"
      aria-selected={selected}
    >
      <button
        className={`group flex w-full flex-col gap-2 text-left ${lesson.locked ? "cursor-default" : "cursor-pointer"}`}
        onClick={() => { if (!lesson.locked) onOpen(lesson); }}
        disabled={lesson.locked}
      >
        <div className={`flex flex-wrap items-baseline gap-3 ${lesson.locked ? "opacity-50" : ""}`}>
          <span className="font-serif text-sm tracking-widest text-muted">
            {lesson.order.toString().padStart(2, "0")}
          </span>
          <span
            className={`flex-1 font-serif text-lg transition-colors ${
              lesson.locked ? "text-muted" : selected ? "text-accent" : "text-text group-hover:text-accent"
            }`}
          >
            {lesson.title}
          </span>
          {(lesson.completedAt ?? !available) && (
            <Badge
              variant={!lesson.completedAt && available ? "accent" : "default"}
              className="uppercase tracking-wide"
            >
              {lesson.completedAt ? "terminée" : available ? "prête" : "à générer"}
            </Badge>
          )}
          <Badge>N{lesson.level}</Badge>
          {lesson.locked && (
            <Badge aria-label="Leçon verrouillée">
              <IconLock size={12} />
            </Badge>
          )}
        </div>

        {lesson.summary && <p className="m-0 text-muted">{lesson.summary}</p>}
        {summary && <p className="m-0 text-sm tracking-wide text-muted">{summary}</p>}

        {lesson.locked ? (
          <p className="m-0 text-sm text-muted">
            Consolide{lesson.prevTitle ? (
              <> <span className="font-medium text-text">«&nbsp;{lesson.prevTitle}&nbsp;»</span></>
            ) : null}{" "}
            pour débloquer cette leçon
          </p>
        ) : inProgress ? (
          <div className="flex flex-col gap-1.5">
            <div className="relative h-2 w-full">
              <div className="absolute inset-0 rounded-full bg-hairline" />
              <div
                className="absolute inset-y-0 left-0 rounded-l-full bg-accent transition-all duration-700 ease-out"
                style={{ width: `${gaugeWidth}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-text/40"
                style={{ left: `${Math.round(SRS.unlockMastery * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>{gaugeWidth} %</span>
              <span>
                {lesson.unlockProgress >= SRS.unlockMastery
                  ? "leçon suivante débloquée ✓"
                  : `débloque la suite à ${Math.round(SRS.unlockMastery * 100)} %`}
              </span>
            </div>
          </div>
        ) : lesson.mastery > 0 ? (
          <ProgressBar value={Math.round(lesson.mastery * 100)} />
        ) : null}

        {!lesson.locked && (
          <span className="self-end text-muted transition-colors group-hover:text-accent">
            <IconArrowRight size={16} />
          </span>
        )}
      </button>

      {lesson.locked && (
        <button
          className="cursor-pointer self-start text-sm text-muted underline"
          onClick={() => {
            void markLessonStarted(lesson.id).then(() => onOpen(lesson));
          }}
        >
          Commencer quand même →
        </button>
      )}

      {/* Une histoire qui se génère en arrière-plan (la leçon est déjà accessible). */}
      {job && busy && <GenProgress label={label} progress={progress} />}
      {error && (
        <p className="flex flex-wrap items-center gap-3 text-sm text-accent">
          {error}
          <button className="cursor-pointer underline" onClick={() => void retry()}>
            Réessayer
          </button>
          <button className="cursor-pointer text-muted underline" onClick={() => void dismiss()}>
            Ignorer
          </button>
        </p>
      )}
    </li>
  );
}
