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
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { IconPlay } from "./kit/Icon";
import { SectionLabel } from "./kit/SectionLabel";
import { ReadabilityBadge } from "./ReadabilityBadge";

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
      <Button
        variant="primary"
        onClick={() => podcast.startLesson(lesson.id)}
        disabled={podcastBusy}
        title="Cadrage parlé, quiz audio, puis l'histoire en écoute bilingue"
      >
        {podcastBusy ? (
          `… ${podcast.preparing ?? ""}`
        ) : (
          <>
            <IconPlay size={16} />
            Podcast
          </>
        )}
      </Button>
    </>
  );

  return (
    <>
      {headerSlot && createPortal(actionButtons, headerSlot)}

      {!headerSlot && (
        <div className="flex flex-wrap items-center gap-2 py-3">{actionButtons}</div>
      )}

      <div className="flex flex-col gap-4 pt-4">

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel as="h3">Le cours</SectionLabel>
      </div>
        <Cours lesson={lesson} />

        {/* En fin de leçon : on vérifie ses acquis après l'avoir parcourue. Les items
            de la leçon entrent en rotation SRS et chaque réponse est replanifiée. */}
        {onStartReview && (
          <div className="flex justify-center py-2">
            <Button
              onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}
              title="Questions sur tout le vocabulaire et la grammaire de la leçon — les réponses alimentent la répétition espacée"
            >
              Vérifier mes acquis
            </Button>
          </div>
        )}

        {ready ? (
          <>
            <hr className="border-hairline" />

            <div className="mb-2 flex items-center justify-between">
              <SectionLabel as="h3">Histoires liées</SectionLabel>
            </div>
            <Card>
              <ul className="flex list-none flex-col">
                {stories.map((s, i) => (
                  <li key={s.id}>
                    {i > 0 && <hr className="my-2 border-hairline" />}
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                        <span className="min-w-0">
                          <span className="font-jp text-sm text-text">{s.title}</span>
                          {s.titleFr && <span className="ml-1 font-sans text-sm text-muted">({s.titleFr})</span>}
                        </span>
                        <ReadabilityBadge text={s.text} />
                      </span>
                      <Button variant="ghost" onClick={() => void read(s)}>
                        Lire →
                      </Button>
                    </div>
                  </li>
                ))}
                {lesson.remoteStoryVariants.map((v, i) => (
                  <li key={`remote-${v}`}>
                    {(stories.length > 0 || i > 0) && <hr className="my-2 border-hairline" />}
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex-1 text-sm italic text-muted">Histoire {v} (disponible)</span>
                      <Button variant="ghost" onClick={() => void addStory(v)} disabled={busy}>
                        {busy ? "Chargement…" : "Ouvrir →"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {storyInProgress && <GenProgress label={label} progress={progress} />}

            {!storyInProgress && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={() => void addStory()} disabled={busy}>
                  {busy ? "Génération…" : "Ajouter une histoire"}
                </Button>
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
      {(grammar.length > 0 || lesson.objectives.vocab.length > 0) && (
        <Card className="flex flex-col gap-4">
          {grammar.length > 0 && (
            <div>
              <SectionLabel as="p" className="mb-2">Grammaire</SectionLabel>
              <ul className="flex list-none flex-col gap-1">
                {grammar.map((g) => (
                  <li key={g.id} className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[6rem_1fr] sm:items-baseline sm:gap-3">
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
              <SectionLabel as="p" className="mb-2">Vocabulaire</SectionLabel>
              <ul className="flex list-none flex-col gap-1">
                {lesson.objectives.vocab.map((v) => (
                  <li key={v.ja} className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[6rem_1fr] sm:items-baseline sm:gap-3">
                    <span className="font-jp text-sm text-text">
                      {v.ja}
                      {v.yomi && v.yomi !== v.ja && (
                        <span className="ml-2 font-jp text-sm italic text-muted">{v.yomi}</span>
                      )}
                    </span>
                    <span className="font-sans text-sm text-text">{v.fr}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {lesson.framing && (
        <div className="mt-6">
          <Markdown text={lesson.framing} reveal={settings.furiganaDefault} />
        </div>
      )}
    </div>
  );
}
