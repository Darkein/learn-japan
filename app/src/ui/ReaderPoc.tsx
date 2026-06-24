import { useState } from "react";
import { analyze, type AnalyzedSentence } from "../lib/analyze";
import { glossString } from "../lib/gloss";
import { Ruby } from "./Ruby";
import styles from "./ReaderPoc.module.css";

const SAMPLES = ["暑いですね", "日本語を勉強する", "猫が水を飲んでいる"];

/** POC Phase 0 : démontre furigana déterministes + gloss littéral en direct. */
export function ReaderPoc() {
  const [text, setText] = useState(SAMPLES[0]);
  const [result, setResult] = useState<AnalyzedSentence | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(t: string) {
    setLoading(true);
    setError(null);
    setRevealed(new Set());
    try {
      setResult(await analyze(t));
    } catch (e) {
      setError(
        "Tokenizer indisponible — vérifie que le dictionnaire kuromoji est servi sous /dict/. " +
          String(e),
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleWord(i: number) {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return (
    <div className={styles.wrap}>
      <textarea
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
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
          <p className={styles.hint}>Tape un mot pour révéler sa lecture.</p>
          <div className={styles.sentence}>
            {result.tokens.map((tok, i) => (
              <span
                key={i}
                className={styles.word}
                onClick={() => toggleWord(i)}
                role="button"
                tabIndex={0}
              >
                <Ruby segments={tok.segments} reveal={revealAll || revealed.has(i)} />
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
    </div>
  );
}
