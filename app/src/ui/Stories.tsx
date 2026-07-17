import { useEffect, useMemo, useState } from "react";
import { allStories, deleteStory, type StoryRecord } from "../lib/db";
import { getCurriculum, lessonsForGrammar } from "../lib/curriculum";
import { DownloadButton } from "./DownloadButton";
import { GeneratePanel } from "./GeneratePanel";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { IconArrowRight, IconClose, IconPause, IconPlay } from "./kit/Icon";
import { LoadingScreen } from "./kit/LoadingScreen";
import { ReadabilityBadge } from "./ReadabilityBadge";
import { StoryIllustration } from "./StoryIllustration";
import { useGenJobs } from "./useGenJobs";
import { usePodcastPlayer } from "./usePodcastPlayer";

function chips(params: StoryRecord["params"]): string[] {
  const out: string[] = [];
  if (params.theme) out.push(`thème : ${params.theme}`);
if (params.grammar?.length) out.push(`grammaire : ${params.grammar.join(", ")}`);
  if (params.level) out.push(`N${params.level}`);
  return out;
}

interface Props {
  /** Ouvre une histoire dans la page de lecture. */
  onOpen: (story: StoryRecord) => void;
}

/** Onglet Histoires : liste seule des histoires enregistrées + panneau de génération. */
export function Stories({ onOpen }: Props) {
  const [stories, setStories] = useState<StoryRecord[] | null>(null);
  const { dataVersion } = useGenJobs();
  const podcast = usePodcastPlayer();
  const lessonTitles = useMemo(() => {
    const m = new Map<string, { order: number; title: string }>();
    for (const c of getCurriculum()) m.set(c.id, { order: c.order, title: c.title });
    return m;
  }, []);

  async function refresh() {
    setStories(await allStories());
  }
  // Se recharge au montage et dès qu'un contenu change (génération, téléchargement) —
  // même mécanique que Catalogue/Home, sans remount de la vue.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  async function remove(id: string) {
    await deleteStory(id);
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {stories === null ? (
        <LoadingScreen />
      ) : stories.length === 0 ? (
        <p className="text-muted">
          Pas encore d'histoire — démarre une leçon dans <strong>Apprendre</strong>, ou génère-en une
          ci-dessous.
        </p>
      ) : (
        <div className="flex flex-col">
          {stories.map((s) => {
            const lesson = s.lessonId ? lessonTitles.get(s.lessonId) : undefined;
            const derivedLessons = lessonsForGrammar(s.params.grammarIds ?? []).filter(
              (l) => l.id !== s.lessonId,
            );
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-start gap-3 border-t border-hairline py-4 last:border-b"
                onClick={() => onOpen(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onOpen(s);
                }}
                aria-label="Ouvrir l'histoire"
              >
                <StoryIllustration storyId={s.id} thumb />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="font-jp text-lg">{s.title}</span>
                  <span className="text-sm text-muted">
                    {new Date(s.createdAt).toLocaleString("fr-FR")}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <ReadabilityBadge text={s.text} />
                    {lesson && (
                      <Badge variant="accent">
                        Leçon {lesson.order.toString().padStart(2, "0")} — {lesson.title}
                      </Badge>
                    )}
                    {derivedLessons.map((l) => (
                      <Badge key={l.id} variant="accent">
                        Leçon {l.order.toString().padStart(2, "0")} — {l.title}
                      </Badge>
                    ))}
                    {chips(s.params).map((c) => (
                      <Badge key={c}>{c}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between gap-4 self-stretch">
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label="Supprimer l'histoire"
                    title="Supprimer l'histoire"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Supprimer cette histoire ?")) void remove(s.id);
                    }}
                  >
                    <IconClose size={16} />
                  </Button>
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-label={
                      podcast.activeStoryId === s.id && podcast.playing
                        ? "Mettre en pause"
                        : "Écouter l'histoire"
                    }
                    title={
                      podcast.activeStoryId === s.id && podcast.playing
                        ? "Mettre en pause"
                        : "Écouter l'histoire"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (podcast.activeStoryId === s.id) podcast.toggle();
                      else podcast.playStory({ storyId: s.id, title: s.titleFr ?? s.title });
                    }}
                  >
                    {podcast.activeStoryId === s.id && podcast.playing ? (
                      <IconPause size={16} />
                    ) : (
                      <IconPlay size={16} />
                    )}
                  </Button>
                  <DownloadButton target={{ kind: "story", storyId: s.id }} size={16} />
                  <span className="text-muted">
                    <IconArrowRight size={16} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GeneratePanel onGenerated={onOpen} />
    </div>
  );
}
