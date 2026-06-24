import { useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import type { ItemStatus } from "../lib/db";
import type { AnnotatedToken } from "../lib/furigana";
import { generateText, type GenState } from "../lib/genClient";
import { glossString } from "../lib/gloss";
import { applyStatus, isContent, itemIdFor, statusesFor, type StatusAction } from "../lib/vocab";
import { Ruby } from "./Ruby";
import { WordSheet } from "./WordSheet";
import styles from "./ReaderPoc.module.css";

const SAMPLES = ["暑いですね", "日本語を勉強する", "猫が水を飲んでいる"];

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

/** POC Phase 0/1 : génération ciblée + furigana & gloss déterministes + panneau mot → SRS. */
export function ReaderPoc() {
  const [text, setText] = useState(SAMPLES[0]);
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus>>(new Map());
  const [revealAll, setRevealAll] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Génération ciblée
  const [theme, setTheme] = useState("");
  const [kanji, setKanji] = useState("");
  const [grammar, setGrammar] = useState("");
  const [level, setLevel] = useState(5);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  async function run(t: string) {
    setLoading(true);
    setError(null);
    setOpenIdx(null);
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
    try {
      const story = await generateText(
        {
          theme: theme || undefined,
          kanji: kanji ? kanji.split(/[\s,、]+/).filter(Boolean) : undefined,
          grammar: grammar ? grammar.split(/[\s,、]+/).filter(Boolean) : undefined,
          level,
        },
        setGenState,
      );
      setText(story);
      await run(story);
    } catch (e) {
      setGenError(String(e));
      setGenState("error");
    }
  }

  async function handleAction(action: StatusAction) {
    if (openIdx == null || !result) return;
    const tok = result.tokens[openIdx].token;
    const item = await applyStatus(tok, action);
    setStatuses((prev) => new Map(prev).set(itemIdFor(tok), item.status));
    setOpenIdx(null);
  }

  const generating = genState === "queued" || genState === "generating";

  return (
    <div className={styles.wrap}>
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

      <textarea className={styles.input} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className={styles.controls}>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => run(text)}>
          Analyser
        </button>
        <button className={styles.btn} onClick={() => setRevealAll((v) => !v)}>
          {revealAll ? "Masquer furigana" : "Afficher furigana"}
        </button>
        {SAMPLES.map((s) => (
          <button
            key={s}
            className={styles.btn}
            onClick={() => {
              setText(s);
              run(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {loading && <p className={styles.hint}>Chargement du tokenizer…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {result && !loading && (
        <>
          <p className={styles.hint}>Tape un mot pour l'ouvrir (lecture, sens, suivi de révision).</p>
          <div className={styles.sentence}>
            {result.tokens.map((tok, i) => (
              <span
                key={i}
                className={styles.word}
                style={{ borderBottomColor: underlineColor(tok, statuses) }}
                onClick={() => setOpenIdx(i)}
                role="button"
                tabIndex={0}
              >
                <Ruby segments={tok.segments} reveal={revealAll} />
              </span>
            ))}
          </div>
          <div className={styles.glossLine}>
            {result.gloss.map((g, i) => (
              <span key={i}>
                <span className={g.grammatical ? styles.glossGram : undefined}>{g.gloss}</span>
                {i < result.gloss.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
          <p className={styles.hint}>Gloss compact : {glossString(result.gloss)}</p>
        </>
      )}

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
