import { createPortal } from "react-dom";
import { useContext, useEffect } from "react";
import type { StoryRecord } from "../lib/db";
import { grammarDetail } from "../lib/inventory";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { GenProgress } from "./GenProgress";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { ReaderHeaderSlot } from "./ReaderPage";
import { useLessonGen } from "./useLessonGen";
import { useSettings } from "./useSettings";
import { Markdown } from "./LessonMarkdown";

interface Props {
  lesson: Lesson;
  onOpenStory: (story: StoryRecord) => void;
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
}

export function CourseDetail({ lesson, onOpenStory, onStartReview }: Props) {
  const stories = lesson.stories;
  const { job, busy, error, start, addStory, progress, label, retry, dismiss } =
    useLessonGen(lesson);
  const podcast = usePodcastPlayer();
  const podcastBusy = podcast.active && podcast.preparing !== null;

  const ready = lesson.state === "ready";
  const storyInProgress = busy && job?.phase === "story";

  const lessonId = lesson.id;
  useEffect(() => {
    if (!lesson.framing && !error) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  const headerSlot = useContext(ReaderHeaderSlot);

  const actionButtons = (
    <>
      <button
        className="cursor-pointer rounded-sm border border-accent px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => podcast.startLesson(lesson.id)}
        disabled={podcastBusy}
        title="Cadrage parlé, quiz audio, puis l'histoire en écoute bilingue"
      >
        {podcastBusy ? `… ${podcast.preparing ?? ""}` : "▶ Podcast"}
      </button>
      {onStartReview && (
        <button
          className="cursor-pointer rounded-sm border border-accent px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent hover:text-white"
          onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}
          title="Questions immédiates sur tout le vocabulaire et la grammaire"
        >
          S'entraîner
        </button>
      )}
    </>
  );

  return (
    <>
      {headerSlot && createPortal(actionButtons, headerSlot)}

      {!headerSlot && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-hairline bg-bg py-3">
          {actionButtons}
        </div>
      )}

      <div className="flex flex-col gap-4 pt-4">

      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-sans text-sm uppercase tracking-widest text-muted">Le cours</h3>
      </div>
        <Cours lesson={lesson} />

        {ready ? (
          <>
            <hr className="border-hairline" />

            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-sans text-sm uppercase tracking-widest text-muted">Histoires liées</h3>
            </div>
            <div className="rounded-sm border border-hairline bg-surface px-4 py-4">
              <ul className="flex list-none flex-col">
                {stories.map((s, i) => (
                  <li key={s.id}>
                    {i > 0 && <hr className="my-2 border-hairline" />}
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="font-jp text-sm text-text">{s.title}</span>
                        {s.titleFr && <span className="ml-1 font-sans text-sm text-muted">({s.titleFr})</span>}
                      </span>
                      <button
                        className="cursor-pointer shrink-0 rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void read(s)}
                      >
                        Lire →
                      </button>
                    </div>
                  </li>
                ))}
                {lesson.remoteStoryVariants.map((v, i) => (
                  <li key={`remote-${v}`}>
                    {(stories.length > 0 || i > 0) && <hr className="my-2 border-hairline" />}
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex-1 text-sm italic text-muted">Histoire {v} (disponible)</span>
                      <button
                        className="cursor-pointer shrink-0 rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void addStory(v)}
                        disabled={busy}
                      >
                        {busy ? "Chargement…" : "Ouvrir →"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {storyInProgress && <GenProgress label={label} progress={progress} />}

            {!storyInProgress && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void addStory()}
                  disabled={busy}
                >
                  {busy ? "Génération…" : "Ajouter une histoire"}
                </button>
              </div>
            )}
          </>
        ) : (
          busy && <GenProgress label={label} progress={progress} />
        )}

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
      </div>
    </>
  );
}

function Cours({ lesson }: { lesson: Lesson }) {
  const { settings } = useSettings();
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  return (
    <div>
      {lesson.framing && <Markdown text={lesson.framing} reveal={settings.furiganaDefault} />}

      {(grammar.length > 0 || lesson.objectives.vocab.length > 0) && (
        <div className="mt-6 flex flex-col gap-4 rounded-sm border border-hairline bg-surface px-4 py-4">
          {grammar.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-xs uppercase tracking-wider text-muted">Grammaire</p>
              <ul className="flex list-none flex-col gap-1">
                {grammar.map((g) => (
                  <li key={g.id} className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
                    <span className="font-jp text-sm text-text">{g.name}</span>
                    <span className="font-sans text-sm text-text">
                      {g.ruleFr} <em>ex. {g.exampleJa}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lesson.objectives.vocab.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-xs uppercase tracking-wider text-muted">Vocabulaire</p>
              <ul className="flex list-none flex-col gap-1">
                {lesson.objectives.vocab.map((v) => (
                  <li key={v.ja} className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
                    <span className="font-jp text-sm text-text">
                      {v.ja}
                      {v.yomi && v.yomi !== v.ja && (
                        <span className="ml-2 font-jp text-xs italic text-muted">{v.yomi}</span>
                      )}
                    </span>
                    <span className="font-sans text-sm text-text">{v.fr}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
