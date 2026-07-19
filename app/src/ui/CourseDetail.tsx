import { createPortal } from "react-dom";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { grammarDetail } from "../lib/inventory";
import { findBlockForSegment, parseBlocks } from "../lib/lessonMarkdown";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { activeTrackIndex, trackEntries, type PodcastSegment } from "../lib/podcastScript";
import { DownloadButton } from "./DownloadButton";
import { GenProgress } from "./GenProgress";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { ReaderBarSlot } from "./ReaderPage";
import { useLessonGen } from "./useLessonGen";
import { useSettings } from "./useSettings";
import { Markdown } from "./LessonMarkdown";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { IconArrowRight, IconPause, IconPlay } from "./kit/Icon";
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

  // Suivi de lecture : segment courant quand C'EST cette leçon qui joue (même en pause).
  const currentTrack = podcast.queue[podcast.queueIndex];
  const playingThisLesson =
    podcast.active && currentTrack?.kind === "lesson" && currentTrack.lessonId === lesson.id;
  const curSeg: PodcastSegment | undefined = playingThisLesson
    ? podcast.segments[podcast.index]
    : undefined;
  // Libellé de l'élément courant à la granularité de la tracklist (les segments sans
  // label sont rattachés à l'élément précédent) — même logique que la barre du lecteur.
  const tracks = useMemo(
    () => (playingThisLesson ? trackEntries(podcast.segments) : []),
    [playingThisLesson, podcast.segments],
  );
  const trackLabel = tracks[activeTrackIndex(tracks, podcast.index)]?.seg.label;

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

  const barSlot = useContext(ReaderBarSlot);

  // Actions de la barre sticky (icônes seules, à côté de la roue) : podcast et
  // téléchargement — même registre que la page histoire et les lignes de liste.
  // En aperçu (couche voisine du carrousel), rendu à l'identique pour la mise en
  // page mais inerte, pour ne pas lancer le podcast de la voisine.
  const lessonPlaying = playingThisLesson && podcast.playing;
  const barActions = (
    <div
      className={`flex items-center gap-1 ${preview ? "pointer-events-none" : ""}`}
      aria-hidden={preview || undefined}
    >
      <Button
        size="icon"
        variant="quiet"
        aria-label={lessonPlaying ? "Mettre en pause" : "Écouter le podcast"}
        title={
          lessonPlaying
            ? "Mettre en pause"
            : "Podcast : cadrage parlé, quiz audio, puis l'histoire en écoute bilingue"
        }
        disabled={podcastBusy}
        tabIndex={preview ? -1 : undefined}
        className={lessonPlaying ? "text-accent" : ""}
        onClick={
          preview
            ? undefined
            : () => {
                if (playingThisLesson) podcast.toggle();
                else podcast.startLesson(lesson.id);
              }
        }
      >
        {lessonPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
      </Button>
      <DownloadButton target={{ kind: "lesson", lesson }} />
    </div>
  );

  return (
    <>
      {barSlot ? (
        createPortal(barActions, barSlot)
      ) : (
        <div className="flex flex-wrap items-center gap-2 py-3">{barActions}</div>
      )}

      <div className="flex flex-col gap-4 pt-4">

      {/* Encart « en cours de lecture » : contrepartie visible des chapitres quiz et
          compréhension, qui n'ont pas d'équivalent rendu dans la page. */}
      {curSeg && curSeg.text.trim() && (
        <Card accentFlag className="flex items-baseline gap-3 px-4 py-2">
          <SectionLabel className="shrink-0">
            {trackLabel ??
              (curSeg.chapter === "comprehension" ? "Compréhension" : curSeg.chapter === "quiz" ? "Quiz" : curSeg.chapter === "histoire" ? "Histoire" : "Cours")}
          </SectionLabel>
          <span className="min-w-0 flex-1 truncate font-sans text-sm text-text">{curSeg.text}</span>
        </Card>
      )}

      <div className="mb-2 flex items-center justify-between">
        <SectionLabel as="h3">Le cours</SectionLabel>
      </div>
        <Cours
          lesson={lesson}
          activeSegment={curSeg?.chapter === "cours" ? curSeg : null}
          follow={podcast.playing && podcast.autoNavigate}
        />

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
                      className={`flex cursor-pointer items-center gap-3 ${
                        curSeg?.storyId === s.id ? "-mx-2 rounded-sm bg-accent/10 px-2 py-1" : ""
                      }`}
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
                        {curSeg?.storyId === s.id && <Badge variant="accent">En lecture</Badge>}
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

function Cours({
  lesson,
  activeSegment,
  follow,
}: {
  lesson: Lesson;
  /** Segment « cours » en cours de lecture (surlignage du bloc correspondant), null sinon. */
  activeSegment: PodcastSegment | null;
  follow: boolean;
}) {
  const { settings } = useSettings();
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);

  // Bloc affiché correspondant au segment parlé. La lecture est linéaire : on repart du
  // dernier bloc trouvé (biais monotone) pour lever l'ambiguïté des fragments courts.
  const blocks = useMemo(() => parseBlocks(lesson.framing ?? ""), [lesson.framing]);
  const lastMatchRef = useRef(0);
  const activeBlock = useMemo(() => {
    if (!activeSegment) return -1;
    const i = findBlockForSegment(blocks, activeSegment.text, activeSegment.label, lastMatchRef.current);
    if (i >= 0) lastMatchRef.current = i;
    return i;
  }, [blocks, activeSegment]);
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
                  <li key={v.ja} className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
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
          <Markdown
            text={lesson.framing}
            reveal={settings.furiganaDefault}
            activeBlock={activeBlock}
            follow={follow}
          />
        </div>
      )}
    </div>
  );
}
