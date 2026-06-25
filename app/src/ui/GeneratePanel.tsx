import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { generateText, type GenState } from "../lib/genClient";
import { saveStory, type StoryParams } from "../lib/stories";
import styles from "./GeneratePanel.module.css";

const GEN_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

interface Props {
  /** Appelée avec l'histoire enregistrée → l'appelant navigue vers la page de lecture. */
  onGenerated: (story: StoryRecord) => void;
}

/**
 * Génération ciblée d'une histoire (thème / kanji / grammaire / niveau) et collage de
 * texte libre. Enregistre l'histoire puis la remonte pour ouverture dans le lecteur.
 */
export function GeneratePanel({ onGenerated }: Props) {
  const [theme, setTheme] = useState("");
  const [kanji, setKanji] = useState("");
  const [grammar, setGrammar] = useState("");
  const [level, setLevel] = useState(5);
  const [paste, setPaste] = useState("");
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generating = genState === "queued" || genState === "generating";

  async function generate() {
    setError(null);
    setGenState("queued");
    const params: StoryParams = {
      theme: theme || undefined,
      kanji: kanji ? kanji.split(/[\s,、]+/).filter(Boolean) : undefined,
      grammar: grammar ? grammar.split(/[\s,、]+/).filter(Boolean) : undefined,
      level,
    };
    try {
      const text = await generateText(params, setGenState);
      const story = await saveStory(text, params);
      onGenerated(story);
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  async function openPasted() {
    if (!paste.trim()) return;
    const story = await saveStory(paste, { level });
    onGenerated(story);
  }

  return (
    <div className={styles.panel}>
      <span className={styles.kicker}>Générer une histoire</span>
      <div className={styles.row}>
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
        {genState && <span className={styles.status}>Statut : {GEN_LABEL[genState]}</span>}
      </div>
      {error && <p className={styles.error}>{error}</p>}

      <details className={styles.advanced}>
        <summary className={styles.summary}>Coller un texte japonais</summary>
        <textarea
          className={styles.input}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          spellCheck={false}
          placeholder="Colle ici une phrase ou un texte japonais libre…"
        />
        <div className={styles.controls}>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={openPasted} disabled={!paste.trim()}>
            Lire ce texte
          </button>
        </div>
      </details>
    </div>
  );
}
