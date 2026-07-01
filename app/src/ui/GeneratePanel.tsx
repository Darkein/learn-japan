import { useEffect, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { generateText, type GenState } from "../lib/genClient";
import { resolveGrammar } from "../lib/inventory";
import { getUnlockedGrammarIds } from "../lib/lessons";
import { saveStory, type StoryParams } from "../lib/stories";
import { GrammarMultiSelect } from "./GrammarMultiSelect";
import { useNotify } from "./useNotify";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

const GEN_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

interface Props {
  /** Ouvre une histoire dans la page de lecture (collage, ou action d'un bandeau). */
  onGenerated: (story: StoryRecord) => void;
}

/**
 * Génération ciblée d'une histoire (thème / grammaire / niveau) et collage de
 * texte libre. La génération ne redirige plus de force : elle enregistre l'histoire et
 * signale par un bandeau qu'elle est prête (ouverture sur demande). Le collage, lui, est
 * une action explicite et ouvre directement le lecteur.
 */
export function GeneratePanel({ onGenerated }: Props) {
  const [theme, setTheme] = useState("");
  const [grammarIds, setGrammarIds] = useState<string[]>([]);
  const [unlockedGrammarIds, setUnlockedGrammarIds] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState(5);
  const [paste, setPaste] = useState("");
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useNotify();

  useEffect(() => {
    void getUnlockedGrammarIds().then((ids) => setUnlockedGrammarIds(new Set(ids)));
  }, []);

  const generating = genState === "queued" || genState === "generating";

  async function generate() {
    setError(null);
    setGenState("queued");
    const params: StoryParams = {
      theme: theme || undefined,
      grammar: grammarIds.length ? grammarIds.map(resolveGrammar) : undefined,
      grammarIds: grammarIds.length ? grammarIds : undefined,
      level,
    };
    try {
      const text = await generateText(params, setGenState);
      const story = await saveStory(text, params);
      notify({
        message: "Histoire générée.",
        action: { label: "Ouvrir →", onClick: () => onGenerated(story) },
      });
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
    <Card className="flex flex-col gap-3">
      <SectionLabel>Générer une histoire</SectionLabel>
      <div className="flex flex-wrap gap-3">
        <div className="flex grow basis-32 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-theme">Thème</label>
          <input className="h-11 rounded-sm border border-hairline bg-bg p-2 text-text" id="g-theme" value={theme} placeholder="animaux, izakaya…" onChange={(e) => setTheme(e.target.value)} />
        </div>
        <div className="flex grow basis-full flex-col gap-1 sm:basis-32">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-grammar">Grammaire</label>
          <GrammarMultiSelect
            inputId="g-grammar"
            value={grammarIds}
            onChange={setGrammarIds}
            unlockedIds={unlockedGrammarIds}
          />
        </div>
        <div className="flex shrink-0 grow-0 basis-20 flex-col gap-1">
          <label className="font-sans text-xs uppercase tracking-wider text-muted" htmlFor="g-level">JLPT</label>
          <select className="h-11 appearance-none rounded-sm border border-hairline bg-bg p-2 text-text" id="g-level" value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                N{n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={generate} disabled={generating}>
          {generating ? "Génération…" : "Générer"}
        </Button>
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
          <Button variant="primary" onClick={openPasted} disabled={!paste.trim()}>
            Lire ce texte
          </Button>
        </div>
      </details>
    </Card>
  );
}
