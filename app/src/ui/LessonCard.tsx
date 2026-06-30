import { useEffect, useState } from "react";
import type { Lesson } from "../lib/lessons";
import { markLessonStarted } from "../lib/lessons";
import { SRS } from "../lib/config";
import { GenProgress } from "./GenProgress";
import { useLessonGen } from "./useLessonGen";

interface Props {
  lesson: Lesson;
  /** Ouvre le cours (panneau latéral en split, page dédiée sinon). */
  onOpen: (lesson: Lesson) => void;
  /** Sélectionne la carte sans la déclencher (mode split). */
  selected?: boolean;
}

// Résumé compact des objectifs, ex. « 5 mots · 2 kanji · 1 point de grammaire ».
function summarize(lesson: Lesson): string {
  const parts: string[] = [];
  const v = lesson.objectives.vocab.length;
  const k = lesson.objectives.kanji.length;
  const g = lesson.objectives.grammar.length;
  if (v) parts.push(`${v} mot${v > 1 ? "s" : ""}`);
  if (k) parts.push(`${k} kanji`);
  if (g) parts.push(`${g} point${g > 1 ? "s" : ""} de grammaire`);
  return parts.join(" · ");
}

export function LessonCard({ lesson, onOpen, selected }: Props) {
  const { job, busy, error, progress, label, retry, dismiss } = useLessonGen(lesson);

  const ready = lesson.state === "ready";
  const available = ready || lesson.pregenerated;
  const summary = summarize(lesson);
  const showMastery = lesson.mastery > 0 && !lesson.locked;

  const [gaugeWidth, setGaugeWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setGaugeWidth(Math.round((lesson.prevMastery ?? 0) * 100)), 50);
    return () => clearTimeout(t);
  }, [lesson.prevMastery]);

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
            <span
              
              className={`rounded-sm border border-transparent px-2 py-0.5 text-xs uppercase tracking-wide ${
                lesson.completedAt
                  ? "border-hairline text-muted opacity-80"
                  : available
                    ? "border-accent text-accent"
                    : "border-hairline text-muted"
              }`}
            >
              {lesson.completedAt ? "terminée" : available ? "prête" : "à générer"}
            </span>
          )}
          <span className="rounded-sm border border-hairline px-2 text-xs text-muted">
            N{lesson.level}
          </span>
          {lesson.locked && (
            <span className="rounded-sm border border-hairline px-2 py-0.5 text-xs uppercase tracking-wide text-muted">
              🔒 
            </span>
          )}
        </div>

        {lesson.summary && <p className="m-0 text-muted">{lesson.summary}</p>}
        {summary && <p className="m-0 text-xs tracking-wide text-muted">{summary}</p>}

        {lesson.locked && (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-xs text-muted">
              Maîtrise{lesson.prevTitle ? (
                <> <span className="font-medium text-text">«&nbsp;{lesson.prevTitle}&nbsp;»</span></>
              ) : null}{" "}
              pour débloquer cette leçon
            </p>
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
              <span className="opacity-60">objectif : {Math.round(SRS.unlockMastery * 100)} %</span>
            </div>
          </div>
        )}

        {showMastery && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(lesson.mastery * 100)}%` }}
            />
          </div>
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
