import { createPortal } from "react-dom";
import { useContext, useEffect, useState } from "react";
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
import { IconArrowRight, IconPlay } from "./kit/Icon";
import { SectionLabel } from "./kit/SectionLabel";
import { ReadabilityBadge } from "./ReadabilityBadge";
import { StoryIllustration } from "./StoryIllustration";

interface Props {
  lesson: Lesson;
  onOpenStory: (story: StoryRecord) => void;
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
  /** Rendu en aperçu (couche voisine du carrousel) : neutralise les effets de bord au montage
   * (pas de génération auto du cours ni de `markLessonStarted`) et masque les actions d'en-tête. */
  preview?: boolean;
}

export function CourseDetail({ lesson, onOpenStory, onStartReview, preview = false }: Props) {
  const stories = lesson.stories;
  const { job, busy, error, start, addStory, regenerateCourse, progress, label, retry, dismiss } =
    useLessonGen(lesson);
  const podcast = usePodcastPlayer();
  const podcastBusy = podcast.active && podcast.preparing !== null;

  const ready = lesson.state === "ready";
  const storyInProgress = busy && job?.phase === "story";

  const lessonId = lesson.id;
  useEffect(() => {
    // Cours absent OU périmé (curriculum changé sous cet id) : (re)génération auto.
    // L'ancien cours reste affiché pendant la régénération ; conservé si elle échoue.
    // En aperçu (couche voisine du carrousel), on ne génère pas (effet de bord + markStarted) :
    // la génération réelle se fera au montage actif, après validation du geste.
    if (!preview && (!lesson.framing || lesson.framingStale) && !error) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  // « Ouvrir → » sur une variante distante : le job télécharge l'histoire depuis le cache
  // R2, puis on l'ouvre dès qu'elle apparaît dans la leçon (au lieu de laisser l'utilisateur
  // re-cliquer dans la liste).
  const [pendingVariant, setPendingVariant] = useState<number | null>(null);
  useEffect(() => {
    if (pendingVariant == null) return;
    const s = stories.find((x) => x.variant === pendingVariant);
    if (s) {
      setPendingVariant(null);
      void read(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, pendingVariant]);

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
      {/* En aperçu, pas d'actions d'en-tête (non interactif, évite un portail parasite). */}
      {!preview && headerSlot && createPortal(actionButtons, headerSlot)}

      {!preview && !headerSlot && (
        <div className="flex flex-wrap items-center gap-2 py-3">{actionButtons}</div>
      )}

      <div className="flex flex-col gap-4 pt-4">

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel as="h3">Le cours</SectionLabel>
      </div>
        <Cours lesson={lesson} />

        {/* En fin de leçon : on vérifie ses acquis après l'avoir parcourue. Les items
            de la leçon entrent en rotation SRS et chaque réponse est replanifiée. */}
        {onStartReview && ready && !busy && (
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
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex cursor-pointer items-center gap-3"
                      onClick={() => void read(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void read(s);
                      }}
                    >
                      <StoryIllustration storyId={s.id} thumb />
                      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-2">
                        <span className="min-w-0">
                          <span className="font-jp text-sm text-text">{s.title}</span>
                          {s.titleFr && <span className="ml-1 font-sans text-sm text-muted">({s.titleFr})</span>}
                        </span>
                        <ReadabilityBadge text={s.text} />
                      </span>
                      <span className="shrink-0 text-muted">
                        <IconArrowRight size={16} />
                      </span>
                    </div>
                  </li>
                ))}
                {lesson.remoteStoryVariants.map((v, i) => (
                  <li key={`remote-${v}`}>
                    {(stories.length > 0 || i > 0) && <hr className="my-2 border-hairline" />}
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <span className="flex-1 text-sm italic text-muted">Histoire {v} (disponible)</span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setPendingVariant(v);
                          void addStory(v);
                        }}
                        disabled={busy}
                      >
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

        {ready && lesson.framing && (
          <p className="pt-2 text-center text-xs text-muted">
            La leçon contient des erreurs ?{" "}
            <button
              className="cursor-pointer underline disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Régénérer le cours de cette leçon ? L'actuel sera remplacé.")) {
                  regenerateCourse();
                }
              }}
              title="Génère un nouveau cours (l'actuel est conservé si la régénération échoue)"
            >
              Cliquez ici pour la régénérer.
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
