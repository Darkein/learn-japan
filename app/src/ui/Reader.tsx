import { useEffect, useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import { recordEncounters, type ReEncounter } from "../lib/encounters";
import { getStory, type ItemStatus, type StoryRecord } from "../lib/db";
import { getLesson } from "../lib/lessons";
import type { AnnotatedToken } from "../lib/furigana";
import { resolveGrammar } from "../lib/inventory";
import { getCurriculumEntry, type LessonObjectives } from "../lib/curriculum";
import type { StoryParams } from "../lib/stories";
import { applyStatus, isContent, itemIdFor, statusesFor, type StatusAction } from "../lib/vocab";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { IconChevronDown, IconPause, IconPlay } from "./kit/Icon";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { SectionLabel } from "./kit/SectionLabel";
import { ReaderExercises } from "./ReaderExercises";
import { Ruby } from "./Ruby";
import { StoryIllustration } from "./StoryIllustration";
import { useSettings } from "./useSettings";
import { StoryTranslation } from "./StoryTranslation";
import { useGenJobs } from "./useGenJobs";
import { navigate } from "./useHashRoute";
import { WordSheet } from "./WordSheet";

export interface LessonContext {
  lessonId: string;
  title?: string;
  level?: number;
  objectives?: LessonObjectives;
  /** Ids des points de grammaire (même ordre que `objectives.grammar`) → notation SRS du QCM. */
  grammarIds?: string[];
}

export interface IncomingStory {
  /** Identifiant de l'histoire en base (cache du QCM de compréhension). Absent si non enregistrée. */
  id?: string;
  title?: string;
  text: string;
  params: StoryParams;
  nonce: number;
  lessonContext?: LessonContext;
}

// Construit le contexte de lecture à partir d'une histoire enregistrée. Si l'histoire est
// rattachée à une leçon, on enrichit le contexte (titre, objectifs) depuis le curriculum.
// Partagé entre le shell (ouverture d'une histoire) et le flux d'étude.
export function incomingFromStory(story: StoryRecord): IncomingStory {
  const entry = story.lessonId ? getCurriculumEntry(story.lessonId) : undefined;
  return {
    id: story.id,
    title: story.titleFr ?? story.title,
    text: story.text,
    params: story.params,
    nonce: Date.now(),
    lessonContext: entry
      ? {
          lessonId: entry.id,
          title: entry.title,
          level: entry.level,
          objectives: entry.objectives,
          grammarIds: entry.introduces.grammar,
        }
      : story.lessonId
        ? { lessonId: story.lessonId }
        : undefined,
  };
}

function underlineColor(tok: AnnotatedToken, statuses: Map<string, ItemStatus>): string {
  if (!isContent(tok.token)) return "transparent";
  const st = statuses.get(itemIdFor(tok.token)) ?? "unknown";
  if (st === "review") return "var(--state-review)";
  if (st === "known") return "transparent";
  return "var(--state-unknown)";
}

interface Props {
  incoming: IncomingStory;
  /** Rendu en aperçu (couche voisine du carrousel) : neutralise les effets de bord au montage
   * (pas d'enregistrement de rencontres SRS). Le contenu reste rendu à l'identique. */
  preview?: boolean;
}

/** Lecteur : phrase analysée, gloss aligné mot-à-mot, lecture audio, suivi de révision. */
export function Reader({ incoming, preview = false }: Props) {
  const { settings } = useSettings();
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [reEncounters, setReEncounters] = useState<ReEncounter[]>([]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [exoOpen, setExoOpen] = useState(false);
  const [transOpen, setTransOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const lessonCtx = incoming.lessonContext ?? null;
  const { regenerateStory } = useGenJobs();

  const podcast = usePodcastPlayer();
  const isActiveStory = !!incoming.id && podcast.activeStoryId === incoming.id;
  const currentTokenIndex = isActiveStory ? podcast.currentTokenIndex : null;

  // Régénération depuis la page histoire : l'histoire est supprimée puis regénérée en
  // arrière-plan → retour à la leçon (qui affiche la progression et notifie à la fin).
  async function regenerate() {
    if (!incoming.id || !lessonCtx?.lessonId) return;
    if (!window.confirm("Régénérer cette histoire ? La version actuelle sera remplacée par une nouvelle.")) return;
    const [lesson, story] = await Promise.all([getLesson(lessonCtx.lessonId), getStory(incoming.id)]);
    if (!lesson || !story) return;
    regenerateStory(lesson, story);
    navigate(`/cours/${encodeURIComponent(lesson.id)}`);
  }

  // (Ré)analyse à chaque ouverture d'une histoire/leçon.
  useEffect(() => {
    void run(incoming.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.nonce]);

  async function run(t: string) {
    if (!t.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setOpenIdx(null);
    setExoOpen(false);
    setTransOpen(false);
    try {
      const analyzed = await analyze(t);
      setResult(analyzed);
      const ids = analyzed.tokens.filter((x) => isContent(x.token)).map((x) => itemIdFor(x.token));
      setStatuses(await statusesFor(ids));
      // En aperçu (couche voisine du carrousel), ne pas enregistrer de rencontre SRS : le geste
      // peut être annulé, et l'enregistrement se fera au montage réel après validation.
      if (!preview) setReEncounters(await recordEncounters(incoming.id, ids));
    } catch (e) {
      setError(
        "Tokenizer indisponible — vérifie que le dictionnaire kuromoji est servi sous /dict/. " +
          String(e),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: StatusAction) {
    if (openIdx == null || !result) return;
    const tok = result.tokens[openIdx].token;
    const item = await applyStatus(tok, action);
    setStatuses((prev) => new Map(prev).set(itemIdFor(tok), item.status));
    setOpenIdx(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {lessonCtx && (
        <Card accentFlag className="flex flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <SectionLabel>Leçon{lessonCtx.level ? ` · N${lessonCtx.level}` : ""}</SectionLabel>
            {lessonCtx.title && (
              <span className="font-serif text-lg text-text">{lessonCtx.title}</span>
            )}
          </div>
          {lessonCtx.objectives && lessonCtx.objectives.vocab.length > 0 && (
            <p className="m-0 text-sm text-muted">
              cible :{" "}
              {lessonCtx.objectives.vocab.slice(0, 4).map((v, i, arr) => (
                <span key={`${v.ja}-${i}`}>
                  <span className="font-jp text-text">{v.ja}</span>
                  <span className="text-muted"> ({v.fr})</span>
                  {i < arr.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
        </Card>
      )}

      {result && !loading && (
        <>
          <StoryIllustration storyId={incoming.id} />
          <p className="text-sm text-muted">Tape un mot pour ouvrir lecture, sens et suivi de révision.</p>
          <div className={`flex flex-wrap items-baseline gap-x-1.5 ${settings.furiganaDefault ? "gap-y-1" : "gap-y-3"}`}>
            {result.tokens.map((tok, i) => {
              const g = result.gloss[i];
              const active = i === currentTokenIndex;
              // Estompage : un mot marqué « connu » perd ses béquilles (gloss, furigana) —
              // le sens reste accessible au tap. Ne concerne que les mots de contenu suivis.
              const known =
                settings.glossHideKnown &&
                isContent(tok.token) &&
                statuses.get(itemIdFor(tok.token)) === "known";
              return (
                <span
                  key={i}
                  className="group inline-flex cursor-pointer flex-col items-center gap-0.5"
                  onClick={() => setOpenIdx(i)}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className={`font-jp text-xl border-b-2 border-transparent pb-0.5 transition-colors group-hover:border-state-unknown ${active ? "rounded-sm bg-accent/20 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]" : ""}`}
                    style={{ borderBottomColor: underlineColor(tok, statuses) }}
                  >
                    <Ruby
                      segments={tok.segments}
                      reveal={settings.furiganaDefault && !known}
                      reserve={settings.furiganaDefault}
                    />
                  </span>
                  {settings.glossDefault && !known && (
                    <span
                      className={`max-w-28 truncate text-center font-sans text-xs text-muted ${g.grammatical ? "italic text-accent-2" : ""}`}
                      title={g.gloss}
                    >
                      {g.gloss}
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative inline-flex">
              <div
                className={`inline-flex items-stretch overflow-hidden rounded-sm border bg-surface transition-colors ${
                  isActiveStory && podcast.playing ? "border-accent" : "border-hairline-strong hover:border-accent"
                } ${!incoming.id ? "opacity-50" : ""}`}
              >
                <button
                  onClick={() => {
                    if (!incoming.id) return;
                    if (isActiveStory) podcast.toggle();
                    else podcast.playStory({ storyId: incoming.id, title: incoming.title ?? "Histoire" });
                  }}
                  disabled={!incoming.id || (isActiveStory && !!podcast.preparing)}
                  className={`inline-flex min-h-11 items-center gap-2 px-4 font-sans text-sm transition-colors disabled:cursor-not-allowed ${
                    isActiveStory && podcast.playing ? "text-accent" : "text-text"
                  } ${incoming.id ? "cursor-pointer hover:bg-surface-2" : ""}`}
                >
                  {isActiveStory && podcast.playing ? (
                    <>
                      <IconPause size={16} />
                      Pause
                    </>
                  ) : (
                    <>
                      <IconPlay size={16} />
                      Écouter
                    </>
                  )}
                </button>
                <button
                  aria-label="Options de lecture"
                  onClick={() => setMenuOpen((o) => !o)}
                  disabled={!incoming.id}
                  aria-expanded={menuOpen}
                  className={`inline-flex items-center border-l border-hairline-strong px-2 text-text transition-colors disabled:cursor-not-allowed ${
                    incoming.id ? "cursor-pointer hover:bg-surface-2" : ""
                  }`}
                >
                  <IconChevronDown size={16} />
                </button>
              </div>
              {menuOpen && incoming.id && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute left-0 top-full z-20 mt-1 rounded-sm border border-hairline bg-surface shadow">
                    <button
                      className="block w-full cursor-pointer whitespace-nowrap px-3 py-2 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        podcast.enqueueStory({ storyId: incoming.id!, title: incoming.title ?? "Histoire" });
                        setMenuOpen(false);
                      }}
                    >
                      Ajouter à la file d'attente
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button variant="primary" onClick={() => setExoOpen(true)}>
              Exercices
            </Button>
            <Button variant="ghost" onClick={() => setTransOpen((v) => !v)}>
              {transOpen ? "Masquer la traduction" : "Traduction française"}
            </Button>
          </div>

          {reEncounters.length > 0 && (
            <p className="text-sm text-muted">
              Tu as recroisé{" "}
              <strong className="font-medium text-text">{reEncounters.length}</strong> mot
              {reEncounters.length > 1 ? "s" : ""} que tu connais.
            </p>
          )}

          {exoOpen && (
            <ReaderExercises
              storyId={incoming.id}
              text={incoming.text}
              level={incoming.params.level ?? lessonCtx?.level ?? 5}
              tokens={result.tokens.map((t) => t.token)}
              grammar={
                lessonCtx
                  ? { ids: lessonCtx.grammarIds ?? [], labels: lessonCtx.objectives?.grammar ?? [] }
                  : incoming.params.grammarIds?.length
                    ? { ids: incoming.params.grammarIds, labels: incoming.params.grammarIds.map(resolveGrammar) }
                    : undefined
              }
              onClose={() => setExoOpen(false)}
            />
          )}

          {transOpen && (
            <StoryTranslation
              storyId={incoming.id}
              text={incoming.text}
              level={incoming.params.level ?? lessonCtx?.level ?? 5}
            />
          )}

          {incoming.id && lessonCtx?.lessonId && (
            <p className="mt-8 text-center text-xs text-muted">
              L'histoire contient des erreurs ?{" "}
              <button className="cursor-pointer underline" onClick={() => void regenerate()}>
                Cliquez ici pour la régénérer.
              </button>
            </p>
          )}
        </>
      )}

      {loading && <p className="text-sm text-muted">Chargement du tokenizer…</p>}
      {error && <p className="text-sm text-accent">{error}</p>}

      {openIdx != null && result && (
        <WordSheet
          token={result.tokens[openIdx].token}
          status={statuses.get(itemIdFor(result.tokens[openIdx].token)) ?? "unknown"}
          onAction={handleAction}
          onClose={() => setOpenIdx(null)}
        />
      )}
    </div>
  );
}
