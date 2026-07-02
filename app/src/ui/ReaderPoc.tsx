import { useEffect, useMemo, useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import type { ItemStatus } from "../lib/db";
import type { AnnotatedToken } from "../lib/furigana";
import { resolveGrammar } from "../lib/inventory";
import type { LessonObjectives } from "../lib/lessons";
import type { StoryParams } from "../lib/stories";
import { splitSentences, useArticlePlayer } from "../lib/tts";
import { applyStatus, isContent, itemIdFor, statusesFor, type StatusAction } from "../lib/vocab";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { IconPause, IconPlay } from "./kit/Icon";
import { SectionLabel } from "./kit/SectionLabel";
import { ReaderExercises } from "./ReaderExercises";
import { Ruby } from "./Ruby";
import { useSettings } from "./useSettings";
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
  title?: string;
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
}

/** Lecteur : phrase analysée, gloss aligné mot-à-mot, lecture audio, suivi de révision. */
export function ReaderPoc({ incoming }: Props) {
  const { settings } = useSettings();
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [exoOpen, setExoOpen] = useState(false);
  const [transOpen, setTransOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessonCtx = incoming.lessonContext ?? null;

  // Lecture audio de l'article : phrases dérivées des tokens (réf. stable tant que
  // l'analyse ne change pas → le player se réinitialise à chaque nouvel article).
  const sentences = useMemo(() => (result ? splitSentences(result.tokens) : []), [result]);
  const player = useArticlePlayer(sentences, settings.storyRate);

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
          <p className="text-sm text-muted">Tape un mot pour ouvrir lecture, sens et suivi de révision.</p>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2">
            {result.tokens.map((tok, i) => {
              const g = result.gloss[i];
              const active = i === player.currentTokenIndex;
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
                    className={`font-jp text-2xl border-b-2 border-transparent pb-0.5 transition-colors group-hover:border-state-unknown ${active ? "rounded-sm bg-accent/20 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]" : ""}`}
                    style={{ borderBottomColor: underlineColor(tok, statuses) }}
                  >
                    <Ruby segments={tok.segments} reveal={settings.furiganaDefault && !known} />
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
            <Button
              active={player.playing}
              onClick={player.toggle}
              disabled={player.loading || sentences.length === 0}
            >
              {player.loading ? (
                "Chargement…"
              ) : player.playing ? (
                <>
                  <IconPause size={16} />
                  Pause
                </>
              ) : (
                <>
                  <IconPlay size={16} />
                  Écouter l'article
                </>
              )}
            </Button>
            <Button variant="primary" onClick={() => setExoOpen(true)}>
              Exercices
            </Button>
            <Button variant="ghost" onClick={() => setTransOpen((v) => !v)}>
              {transOpen ? "Masquer la traduction" : "Traduction française"}
            </Button>
          </div>

          {player.error && <p className="text-sm text-accent">Audio indisponible : {player.error}</p>}

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
