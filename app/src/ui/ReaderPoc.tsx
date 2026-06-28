import { useEffect, useMemo, useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import type { ItemStatus } from "../lib/db";
import type { AnnotatedToken } from "../lib/furigana";
import { markLessonCompleted, type LessonObjectives } from "../lib/lessons";
import type { StoryParams } from "../lib/stories";
import { splitSentences, useArticlePlayer } from "../lib/tts";
import { applyStatus, isContent, itemIdFor, statusesFor, type StatusAction } from "../lib/vocab";
import { Comprehension } from "./Comprehension";
import { Quiz } from "./Quiz";
import { Ruby } from "./Ruby";
import { SentenceBuilder } from "./SentenceBuilder";
import { StoryTranslation } from "./StoryTranslation";
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
  text: string;
  params: StoryParams;
  nonce: number;
  lessonContext?: LessonContext;
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
  /** Appelée après « Marquer comme terminée » (l'appelant peut revenir à l'accueil). */
  onComplete?: () => void;
}

/** Lecteur : phrase analysée, gloss aligné mot-à-mot, lecture audio, suivi de révision. */
export function ReaderPoc({ incoming, onComplete }: Props) {
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [revealFurigana, setRevealFurigana] = useState(false);
  const [revealGloss, setRevealGloss] = useState(true);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [transOpen, setTransOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonCtx = incoming.lessonContext ?? null;
  const [lessonDone, setLessonDone] = useState(false);

  // Lecture audio de l'article : phrases dérivées des tokens (réf. stable tant que
  // l'analyse ne change pas → le player se réinitialise à chaque nouvel article).
  const sentences = useMemo(() => (result ? splitSentences(result.tokens) : []), [result]);
  const player = useArticlePlayer(sentences);

  // (Ré)analyse à chaque ouverture d'une histoire/leçon.
  useEffect(() => {
    setLessonDone(false);
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
    setQuizOpen(false);
    setCompOpen(false);
    setTransOpen(false);
    setBuildOpen(false);
    try {
      const analyzed = await analyze(t);
      setResult(analyzed);
      const ids = analyzed.tokens.filter((x) => isContent(x.token)).map((x) => itemIdFor(x.token));
      setStatuses(await statusesFor(ids));
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

  async function markDone() {
    if (!lessonCtx) return;
    await markLessonCompleted(lessonCtx.lessonId);
    setLessonDone(true);
    onComplete?.();
  }

  return (
    <div className="flex flex-col gap-6">
      {lessonCtx && (
        <aside className="flex flex-col gap-2 rounded-r-sm border-l-4 border-l-accent bg-surface px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-xs uppercase tracking-widest text-muted">
              Leçon{lessonCtx.level ? ` · N${lessonCtx.level}` : ""}
            </span>
            {lessonCtx.title && (
              <span className="font-serif text-lg text-text">{lessonCtx.title}</span>
            )}
          </div>
          {lessonCtx.objectives && (lessonCtx.objectives.vocab.length > 0 || lessonCtx.objectives.kanji.length > 0) && (
            <p className="m-0 text-sm text-muted">
              cible :{" "}
              {[
                ...lessonCtx.objectives.kanji.map((k) => ({ ja: k.ja, fr: k.fr })),
                ...lessonCtx.objectives.vocab.slice(0, 4).map((v) => ({ ja: v.ja, fr: v.fr })),
              ].map((it, i, arr) => (
                <span key={`${it.ja}-${i}`}>
                  <span className="font-jp text-text">{it.ja}</span>
                  <span className="text-muted"> ({it.fr})</span>
                  {i < arr.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void markDone()}
              disabled={lessonDone}
            >
              {lessonDone ? "Marquée terminée ✓" : "Marquer comme terminée"}
            </button>
          </div>
        </aside>
      )}

      {result && !loading && (
        <>
          <p className="text-sm text-muted">Tape un mot pour ouvrir lecture, sens et suivi de révision.</p>
          <div className="flex flex-wrap items-start gap-x-2 gap-y-4">
            {result.tokens.map((tok, i) => {
              const g = result.gloss[i];
              const active = i === player.currentTokenIndex;
              return (
                <span
                  key={i}
                  className="inline-flex cursor-pointer flex-col items-center gap-0.5 border-b-2 border-transparent pb-0.5 transition-colors hover:border-state-unknown"
                  style={{ borderBottomColor: underlineColor(tok, statuses) }}
                  onClick={() => setOpenIdx(i)}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className={`font-jp text-2xl ${active ? "rounded-sm bg-accent/20 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]" : ""}`}
                  >
                    <Ruby segments={tok.segments} reveal={revealFurigana} />
                  </span>
                  <span
                    className={`max-w-40 text-center font-sans text-xs leading-tight text-muted ${g.grammatical ? "italic text-accent-2" : ""}`}
                    style={{ visibility: revealGloss ? "visible" : "hidden" }}
                  >
                    {g.gloss}
                  </span>
                </span>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className={`cursor-pointer rounded-sm border px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${player.playing ? "border-accent bg-accent text-white" : "border-hairline"}`}
              onClick={player.toggle}
              disabled={player.loading || sentences.length === 0}
            >
              {player.loading
                ? "Chargement…"
                : player.playing
                  ? "⏸ Pause"
                  : "▶ Écouter l'article"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setRevealFurigana((v) => !v)}
            >
              {revealFurigana ? "Masquer furigana" : "Afficher furigana"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setRevealGloss((v) => !v)}
            >
              {revealGloss ? "Masquer gloss" : "Afficher gloss"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setQuizOpen((v) => !v)}
            >
              {quizOpen ? "Fermer le quiz" : "Quiz de lecture"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-accent px-4 py-2 text-accent transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setCompOpen((v) => !v)}
            >
              {compOpen ? "Fermer le QCM" : "QCM de compréhension"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setTransOpen((v) => !v)}
            >
              {transOpen ? "Masquer la traduction" : "Traduction française"}
            </button>
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setBuildOpen((v) => !v)}
            >
              {buildOpen ? "Fermer la reconstruction" : "Reconstruire les phrases"}
            </button>
          </div>

          {player.error && <p className="text-sm text-accent">Audio indisponible : {player.error}</p>}

          {quizOpen && (
            <Quiz tokens={result.tokens.map((t) => t.token)} onClose={() => setQuizOpen(false)} />
          )}

          {compOpen && (
            <Comprehension
              storyId={incoming.id}
              text={incoming.text}
              level={incoming.params.level ?? lessonCtx?.level ?? 5}
              grammar={
                lessonCtx
                  ? { ids: lessonCtx.grammarIds ?? [], labels: lessonCtx.objectives?.grammar ?? [] }
                  : undefined
              }
              onClose={() => setCompOpen(false)}
            />
          )}

          {transOpen && (
            <StoryTranslation
              storyId={incoming.id}
              text={incoming.text}
              level={incoming.params.level ?? lessonCtx?.level ?? 5}
            />
          )}

          {buildOpen && (
            <SentenceBuilder
              storyId={incoming.id}
              text={incoming.text}
              level={incoming.params.level ?? lessonCtx?.level ?? 5}
            />
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
