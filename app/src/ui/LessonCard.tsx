import type { StoryRecord } from "../lib/db";
import type { Lesson } from "../lib/lessons";
import { STATE_LABEL, useLessonGen } from "./useLessonGen";

interface Props {
  lesson: Lesson;
  /** Ouvre une histoire de leçon dans la page de lecture. */
  onOpenStory: (story: StoryRecord) => void;
  /** Ouvre le cours (panneau latéral en split, page dédiée sinon). */
  onOpen: (lesson: Lesson) => void;
  /** Sélectionne la carte sans la déclencher (mode split). */
  selected?: boolean;
  /** Notifie le parent qu'une histoire/état a changé (pour rafraîchir la liste). */
  onChanged: () => void;
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

export function LessonCard({ lesson, onOpenStory, onOpen, selected, onChanged }: Props) {
  const { genState, busy, error, start } = useLessonGen(lesson, { onChanged, onOpenStory });

  const ready = lesson.state === "ready";
  const summary = summarize(lesson);

  return (
    <li
      className="flex flex-col gap-2 border-t border-hairline py-4 last:border-b"
      aria-selected={selected}
    >
      <button
        className="group flex w-full cursor-pointer flex-col gap-2 text-left"
        onClick={() => onOpen(lesson)}
      >
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-serif text-sm tracking-widest text-muted">
            {lesson.order.toString().padStart(2, "0")}
          </span>
          <span
            className={`flex-1 font-serif text-lg transition-colors group-hover:text-accent ${
              selected ? "text-accent" : "text-text"
            }`}
          >
            {lesson.title}
          </span>
          <span className="rounded-sm border border-hairline px-2 text-xs text-muted">
            N{lesson.level}
          </span>
          <span
            className={`rounded-sm border border-transparent px-2 py-0.5 text-xs uppercase tracking-wide ${
              lesson.completedAt
                ? "border-hairline text-muted opacity-80"
                : ready
                  ? "border-accent text-accent"
                  : "border-hairline text-muted"
            }`}
          >
            {lesson.completedAt ? "terminée" : ready ? "prête" : "à générer"}
          </span>
        </div>

        {lesson.summary && <p className="m-0 text-muted">{lesson.summary}</p>}
        {summary && <p className="m-0 text-xs tracking-wide text-muted">{summary}</p>}
      </button>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        {ready ? (
          <button
            className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onOpen(lesson)}
          >
            Voir le cours →
          </button>
        ) : (
          <button
            className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? "Génération…" : "Commencer la leçon"}
          </button>
        )}
        {genState && busy && (
          <span className="text-sm text-muted">Statut : {STATE_LABEL[genState]}</span>
        )}
      </div>

      {error && <p className="text-sm text-accent">{error}</p>}
    </li>
  );
}
