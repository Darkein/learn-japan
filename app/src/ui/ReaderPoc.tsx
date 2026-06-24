import { useEffect, useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import type { ItemStatus } from "../lib/db";
import type { AnnotatedToken } from "../lib/furigana";
import { generateText, type GenState } from "../lib/genClient";
import { markLessonCompleted, type LessonObjectives } from "../lib/lessons";
import { saveStory, type StoryParams } from "../lib/stories";
import { applyStatus, isContent, itemIdFor, statusesFor, type StatusAction } from "../lib/vocab";
import { Quiz } from "./Quiz";
import { Ruby } from "./Ruby";
import { WordSheet } from "./WordSheet";
import styles from "./ReaderPoc.module.css";

export interface LessonContext {
  lessonId: string;
  title?: string;
  level?: number;
  objectives?: LessonObjectives;
}

export interface IncomingStory {
  text: string;
  params: StoryParams;
  nonce: number;
  lessonContext?: LessonContext;
}

const GEN_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

function underlineColor(tok: AnnotatedToken, statuses: Map<string, ItemStatus>): string {
  if (!isContent(tok.token)) return "transparent";
  const st = statuses.get(itemIdFor(tok.token)) ?? "unknown";
  if (st === "review") return "var(--state-review)";
  if (st === "known") return "transparent";
  return "var(--state-unknown)";
}

interface Props {
  incoming?: IncomingStory | null;
  onBackToLessons?: () => void;
}

/** Lecteur : phrase analysée, gloss aligné mot-à-mot, mode avancé replié pour les débutants. */
export function ReaderPoc({ incoming, onBackToLessons }: Props) {
  // Le texte courant est persisté (localStorage) → restauré après un rechargement.
  const [text, setText] = useState(() => localStorage.getItem("reader:text") ?? "");
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [revealFurigana, setRevealFurigana] = useState(false);
  const [revealGloss, setRevealGloss] = useState(true);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Génération ciblée (mode avancé)
  const [theme, setTheme] = useState("");
  const [kanji, setKanji] = useState("");
  const [grammar, setGrammar] = useState("");
  const [level, setLevel] = useState(5);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [lastParams, setLastParams] = useState<StoryParams>({});
  const [saved, setSaved] = useState(false);
  const [lessonCtx, setLessonCtx] = useState<LessonContext | null>(null);
  const [lessonDone, setLessonDone] = useState(false);

  // Mémorise le texte courant pour le restaurer au prochain chargement.
  useEffect(() => {
    localStorage.setItem("reader:text", text);
  }, [text]);

  // Ouverture d'une histoire enregistrée ou d'une leçon depuis un autre onglet.
  useEffect(() => {
    if (!incoming) return;
    setText(incoming.text);
    setLastParams(incoming.params);
    setLessonCtx(incoming.lessonContext ?? null);
    setLessonDone(false);
    setSaved(!!incoming.lessonContext); // pas de bouton « enregistrer » utile pour une leçon
    void run(incoming.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.nonce]);

  async function run(t: string) {
    if (!t.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setOpenIdx(null);
    setQuizOpen(false);
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

  async function generate() {
    setGenError(null);
    setGenState("queued");
    const params: StoryParams = {
      theme: theme || undefined,
      kanji: kanji ? kanji.split(/[\s,、]+/).filter(Boolean) : undefined,
      grammar: grammar ? grammar.split(/[\s,、]+/).filter(Boolean) : undefined,
      level,
    };
    try {
      const story = await generateText(params, setGenState);
      setText(story);
      setLastParams(params);
      setLessonCtx(null); // génération libre → pas rattachée à une leçon
      await saveStory(story, params);
      setSaved(true);
      await run(story);
    } catch (e) {
      setGenError(String(e));
      setGenState("error");
    }
  }

  async function saveCurrent() {
    await saveStory(text, lastParams, lessonCtx?.lessonId);
    setSaved(true);
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
  }

  const generating = genState === "queued" || genState === "generating";

  return (
    <div className={styles.wrap}>
      {lessonCtx && (
        <aside className={styles.banner}>
          <div className={styles.bannerHead}>
            <span className={styles.bannerKicker}>Leçon{lessonCtx.level ? ` · N${lessonCtx.level}` : ""}</span>
            {lessonCtx.title && <span className={styles.bannerTitle}>{lessonCtx.title}</span>}
          </div>
          {lessonCtx.objectives && (lessonCtx.objectives.vocab.length > 0 || lessonCtx.objectives.kanji.length > 0) && (
            <p className={styles.bannerTarget}>
              cible :{" "}
              <span className={styles.bannerJp}>
                {[...lessonCtx.objectives.kanji, ...lessonCtx.objectives.vocab.slice(0, 4)].join(" · ")}
              </span>
            </p>
          )}
          <div className={styles.bannerActions}>
            {onBackToLessons && (
              <button className={styles.btn} onClick={onBackToLessons}>
                ← Leçons
              </button>
            )}
            <button
              className={styles.btn}
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
          <p className={styles.hint}>Tape un mot pour ouvrir lecture, sens et suivi de révision.</p>
          <div className={styles.sentence}>
            {result.tokens.map((tok, i) => {
              const g = result.gloss[i];
              return (
                <span
                  key={i}
                  className={styles.wordCell}
                  style={{ borderBottomColor: underlineColor(tok, statuses) }}
                  onClick={() => setOpenIdx(i)}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.wordJa}>
                    <Ruby segments={tok.segments} reveal={revealFurigana} />
                  </span>
                  <span
                    className={`${styles.wordGloss} ${g.grammatical ? styles.glossGram : ""}`}
                    style={{ visibility: revealGloss ? "visible" : "hidden" }}
                  >
                    {g.gloss}
                  </span>
                </span>
              );
            })}
          </div>

          <div className={styles.controls}>
            <button className={styles.btn} onClick={() => setRevealFurigana((v) => !v)}>
              {revealFurigana ? "Masquer furigana" : "Afficher furigana"}
            </button>
            <button className={styles.btn} onClick={() => setRevealGloss((v) => !v)}>
              {revealGloss ? "Masquer gloss" : "Afficher gloss"}
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setQuizOpen((v) => !v)}
            >
              {quizOpen ? "Fermer le quiz" : "Quiz de lecture"}
            </button>
            {!lessonCtx && (
              <button className={styles.btn} onClick={saveCurrent} disabled={saved || !text.trim()}>
                {saved ? "Enregistrée ✓" : "Enregistrer"}
              </button>
            )}
          </div>

          {quizOpen && (
            <Quiz tokens={result.tokens.map((t) => t.token)} onClose={() => setQuizOpen(false)} />
          )}
        </>
      )}

      {loading && <p className={styles.hint}>Chargement du tokenizer…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!result && !loading && !error && !text && (
        <p className={styles.hint}>
          Va dans l'onglet <strong>Apprendre</strong> pour démarrer une leçon, ou ouvre le
          <em> Mode avancé</em> ci-dessous pour coller / générer un texte libre.
        </p>
      )}

      <details className={styles.advanced}>
        <summary className={styles.advancedSummary}>Mode avancé — texte libre &amp; génération ciblée</summary>

        <div className={styles.gen}>
          <span className="meta">Générer une histoire ciblée</span>
          <div className={styles.genRow}>
            <div className={styles.field}>
              <label htmlFor="g-theme">Thème</label>
              <input id="g-theme" value={theme} placeholder="animaux, izakaya…" onChange={(e) => setTheme(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="g-kanji">Kanji</label>
              <input id="g-kanji" value={kanji} placeholder="猫 犬 水" onChange={(e) => setKanji(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="g-grammar">Grammaire</label>
              <input id="g-grammar" value={grammar} placeholder="て-forme, は/が" onChange={(e) => setGrammar(e.target.value)} />
            </div>
            <div className={styles.field} style={{ flex: "0 0 5rem" }}>
              <label htmlFor="g-level">JLPT</label>
              <select id="g-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    N{n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.controls}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={generate} disabled={generating}>
              {generating ? "Génération…" : "Générer"}
            </button>
            {genState && <span className={styles.genStatus}>Statut : {GEN_LABEL[genState]}</span>}
          </div>
          {genError && <p className={styles.error}>{genError}</p>}
        </div>

        <textarea
          className={styles.input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          placeholder="Colle ici une phrase japonaise libre…"
        />
        <div className={styles.controls}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => run(text)}>
            Analyser
          </button>
        </div>
      </details>

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
