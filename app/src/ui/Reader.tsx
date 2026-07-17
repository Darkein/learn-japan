import { useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { analyze, peekAnalysis, type AnalyzedSentence } from "../lib/analyze";
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
import { DownloadButton } from "./DownloadButton";
import { ReaderBarSlot } from "./ReaderPage";
import { IconArrowRight, IconList, IconPause, IconPlay } from "./kit/Icon";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { SectionLabel } from "./kit/SectionLabel";
import { ReaderExercises } from "./ReaderExercises";
import { Ruby } from "./Ruby";
import { StoryIllustration } from "./StoryIllustration";
import { useSettings } from "./useSettings";
import { StoryTranslation } from "./StoryTranslation";
import { useGenJobs } from "./useGenJobs";
import { currentLocation, navigate } from "./useHashRoute";
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
  // Initialisation synchrone depuis le cache d'analyse : si le texte a déjà été analysé (page
  // voisine affichée en aperçu pendant le carrousel), on rend le contenu d'emblée, sans passer
  // par « Chargement du tokenizer… » au remontage de la page active.
  const [result, setResult] = useState<AnalyzedSentence | null>(() => peekAnalysis(incoming.text) ?? null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [reEncounters, setReEncounters] = useState<ReEncounter[]>([]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [exoOpen, setExoOpen] = useState(false);
  const [transOpen, setTransOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonCtx = incoming.lessonContext ?? null;
  const { regenerateStory } = useGenJobs();
  const barSlot = useContext(ReaderBarSlot);

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

  // Ouvre la leçon rattachée depuis l'encart. On conserve l'origine (`from` = la lecture
  // courante) pour que « Retour » depuis la leçon ramène à l'histoire.
  function openLesson() {
    if (!lessonCtx?.lessonId) return;
    navigate(`/cours/${encodeURIComponent(lessonCtx.lessonId)}?from=${encodeURIComponent(currentLocation())}`);
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
    setError(null);
    setOpenIdx(null);
    setExoOpen(false);
    setTransOpen(false);
    // Déjà analysé : affichage immédiat, on n'affiche PAS l'état de chargement (pas de flash
    // « Chargement du tokenizer… » au remontage). On charge quand même statuts + rencontres.
    const cached = peekAnalysis(t);
    if (cached) setResult(cached);
    else setLoading(true);
    try {
      const analyzed = cached ?? (await analyze(t));
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

  // Actions de la barre sticky (icônes seules, à côté de la roue) : lecture/pause,
  // ajout à la file d'attente, téléchargement — même registre que les lignes de liste
  // et que la page leçon. En aperçu (couche voisine du carrousel), rendu à l'identique
  // pour la mise en page mais inerte, pour ne pas agir sur la voisine.
  const playing = isActiveStory && podcast.playing;
  const barActions = (
    <div
      className={`flex items-center gap-1 ${preview ? "pointer-events-none" : ""}`}
      aria-hidden={preview || undefined}
    >
      <Button
        size="icon"
        variant="quiet"
        aria-label={playing ? "Mettre en pause" : "Écouter l'histoire"}
        title={playing ? "Mettre en pause" : "Écouter l'histoire"}
        disabled={!incoming.id || (isActiveStory && !!podcast.preparing)}
        tabIndex={preview ? -1 : undefined}
        className={playing ? "text-accent" : ""}
        onClick={
          preview
            ? undefined
            : () => {
                if (!incoming.id) return;
                if (isActiveStory) podcast.toggle();
                else podcast.playStory({ storyId: incoming.id, title: incoming.title ?? "Histoire" });
              }
        }
      >
        {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
      </Button>
      <Button
        size="icon"
        variant="quiet"
        aria-label="Ajouter à la file d'attente"
        title="Ajouter à la file d'attente"
        disabled={!incoming.id}
        tabIndex={preview ? -1 : undefined}
        onClick={
          preview
            ? undefined
            : () => {
                if (!incoming.id) return;
                podcast.enqueueStory({ storyId: incoming.id, title: incoming.title ?? "Histoire" });
              }
        }
      >
        <IconList size={20} />
      </Button>
      {/* Histoire non enregistrée (lecteur libre) : rien à télécharger. */}
      {incoming.id && <DownloadButton target={{ kind: "story", storyId: incoming.id }} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {barSlot ? (
        createPortal(barActions, barSlot)
      ) : (
        <div className="flex flex-wrap items-center gap-2">{barActions}</div>
      )}
      {lessonCtx && (
        // Encart « leçon liée » cliquable : ouvre la leçon rattachée. En aperçu (couche voisine
        // du carrousel) on n'attache pas la navigation — la couche n'est pas la page active.
        <Card
          accentFlag
          role={preview ? undefined : "button"}
          tabIndex={preview ? undefined : 0}
          aria-label={preview ? undefined : "Ouvrir la leçon"}
          className={`flex items-center gap-3 px-4 py-3 ${preview ? "" : "cursor-pointer"}`}
          onClick={preview ? undefined : openLesson}
          onKeyDown={
            preview
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openLesson();
                  }
                }
          }
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
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
          </div>
          {!preview && (
            <span className="shrink-0 text-muted">
              <IconArrowRight size={16} />
            </span>
          )}
        </Card>
      )}

      {result && !loading && (
        <>
          <StoryIllustration storyId={incoming.id} />
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
