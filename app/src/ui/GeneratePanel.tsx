import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { generateText, type GenState } from "../lib/genClient";
import { saveStory, type StoryParams } from "../lib/stories";

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
    <div className="flex flex-col gap-3 rounded-sm border border-hairline bg-surface p-4">
      <span className="font-sans text-xs uppercase tracking-widest text-muted">
        Générer une histoire
      </span>
      <div className="flex flex-wrap gap-3">
        <div className="flex grow basis-32 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-theme">Thème</label>
          <input className="rounded-sm border border-hairline bg-bg p-2 text-text" id="g-theme" value={theme} placeholder="animaux, izakaya…" onChange={(e) => setTheme(e.target.value)} />
        </div>
        <div className="flex grow basis-32 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-kanji">Kanji</label>
          <input className="rounded-sm border border-hairline bg-bg p-2 text-text" id="g-kanji" value={kanji} placeholder="猫 犬 水" onChange={(e) => setKanji(e.target.value)} />
        </div>
        <div className="flex grow basis-32 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-grammar">Grammaire</label>
          <input className="rounded-sm border border-hairline bg-bg p-2 text-text" id="g-grammar" value={grammar} placeholder="て-forme, は/が" onChange={(e) => setGrammar(e.target.value)} />
        </div>
        <div className="flex shrink-0 grow-0 basis-20 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-level">JLPT</label>
          <select className="rounded-sm border border-hairline bg-bg p-2 text-text" id="g-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                N{n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          onClick={generate}
          disabled={generating}
        >
          {generating ? "Génération…" : "Générer"}
        </button>
        {genState && <span className="text-sm text-muted">Statut : {GEN_LABEL[genState]}</span>}
      </div>
      {error && <p className="text-sm text-accent">{error}</p>}

      <details className="border-t border-hairline pt-3">
        <summary className="cursor-pointer select-none text-sm tracking-wide text-muted hover:text-text">
          Coller un texte japonais
        </summary>
        <textarea
          className="mt-3 min-h-[4.5rem] w-full resize-y rounded-sm border border-hairline bg-bg p-3 font-jp text-lg leading-[1.8] text-text"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          spellCheck={false}
          placeholder="Colle ici une phrase ou un texte japonais libre…"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={openPasted}
            disabled={!paste.trim()}
          >
            Lire ce texte
          </button>
        </div>
      </details>
    </div>
  );
}
