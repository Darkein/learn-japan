import { useEffect, useState } from "react";
import { analyze } from "../lib/analyze";
import { isCorrectOrder, shuffleTiles, toTiles, type Tile } from "../lib/builder";
import type { GenState } from "../lib/genClient";
import { ensureStoryTranslationById, splitJaSentences } from "../lib/podcast";
import type { KuromojiToken } from "../lib/tokenizer";
import { applyStatus, isContent } from "../lib/vocab";

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "…",
};

interface Exercise {
  fr: string;
  tokens: KuromojiToken[];
  target: string[];
  shuffled: Tile[];
}

interface Props {
  storyId?: string;
  text: string;
  level: number;
}

/**
 * Reconstruction de phrase (rappel actif) : à partir de la traduction française, l'utilisateur
 * réordonne les tuiles de mots japonais. La justesse note le vocabulaire de la phrase (FSRS, piste
 * vocab). Monté seulement à la révélation ; calqué sur `Comprehension.tsx`.
 */
export function SentenceBuilder({ storyId, text, level }: Props) {
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [i, setI] = useState(0);
  const [placed, setPlaced] = useState<Tile[]>([]);
  const [checked, setChecked] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGenState("generating");
    (async () => {
      const { sentences: fr } = await ensureStoryTranslationById(storyId, text, level);
      const ja = splitJaSentences(text);
      const built: Exercise[] = [];
      for (let k = 0; k < ja.length; k++) {
        const analyzed = await analyze(ja[k]);
        const tokens = analyzed.tokens.map((t) => t.token);
        const target = toTiles(tokens);
        if (target.length < 2) continue; // phrase trop courte → rien à réordonner
        built.push({ fr: fr[k] ?? "", tokens, target, shuffled: shuffleTiles(target) });
      }
      return built;
    })()
      .then((built) => {
        if (cancelled) return;
        setGenState("ready");
        setExercises(built);
        if (built.length === 0) setError("Aucune phrase à reconstruire pour cette histoire.");
      })
      .catch((e) => {
        if (cancelled) return;
        setGenState("error");
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Régénère si l'histoire change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, text]);

  const card = "flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6";

  if (error) {
    return (
      <div className={card}>
        <p className="text-sm text-accent">{error}</p>
      </div>
    );
  }

  if (!exercises) {
    return (
      <div className={card}>
        <p className="text-sm text-muted">
          Préparation de la reconstruction… {genState ? STATE_LABEL[genState] : ""}
        </p>
      </div>
    );
  }

  if (i >= exercises.length) {
    return (
      <div className={card}>
        <p className="text-lg">
          Reconstruction — {score}/{exercises.length} réussies. Les résultats ont nourri le SRS.
        </p>
      </div>
    );
  }

  const ex = exercises[i];
  const placedKeys = new Set(placed.map((t) => t.key));

  function place(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => [...p, tile]);
  }
  function unplace(tile: Tile) {
    if (checked !== null) return;
    setPlaced((p) => p.filter((t) => t.key !== tile.key));
  }

  async function check() {
    const ok = isCorrectOrder(placed.map((t) => t.tile), ex.target);
    setChecked(ok);
    if (ok) setScore((s) => s + 1);
    // Note le vocabulaire de contenu de la phrase (piste vocab, compétence écrite).
    await Promise.all(
      ex.tokens.filter(isContent).map((t) => applyStatus(t, ok ? "review" : "forgot")),
    );
  }

  function next() {
    setPlaced([]);
    setChecked(null);
    setI((n) => n + 1);
  }

  return (
    <div className={card}>
      <span className="text-xs uppercase tracking-wider text-muted">
        Reconstruction · phrase {i + 1} / {exercises.length}
      </span>
      {ex.fr && <p className="text-text">{ex.fr}</p>}

      {/* Zone de réponse : tuiles posées (clic pour retirer). */}
      <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-sm border border-dashed border-hairline p-2">
        {placed.length === 0 && <span className="text-sm text-muted">Compose la phrase…</span>}
        {placed.map((t) => (
          <button
            key={t.key}
            className="cursor-pointer rounded-sm border border-accent bg-bg px-3 py-1.5 font-jp text-lg text-text disabled:cursor-default"
            onClick={() => unplace(t)}
            disabled={checked !== null}
          >
            {t.tile}
          </button>
        ))}
      </div>

      {/* Tuiles disponibles (mélangées). */}
      <div className="flex flex-wrap gap-2">
        {ex.shuffled.map((t) => (
          <button
            key={t.key}
            className="cursor-pointer rounded-sm border border-hairline bg-bg px-3 py-1.5 font-jp text-lg text-text transition-colors hover:border-accent disabled:opacity-30"
            onClick={() => place(t)}
            disabled={placedKeys.has(t.key) || checked !== null}
          >
            {t.tile}
          </button>
        ))}
      </div>

      {checked === null ? (
        <button
          className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void check()}
          disabled={placed.length === 0}
        >
          Vérifier
        </button>
      ) : (
        <>
          <div className={`text-sm ${checked ? "text-accent-2" : "text-accent"}`}>
            {checked ? "✓ Correct" : `✗ Ordre attendu : ${ex.target.join(" ")}`}
          </div>
          <button
            className="cursor-pointer self-start rounded-sm bg-accent px-4 py-2 text-white"
            onClick={next}
          >
            {i + 1 < exercises.length ? "Suivant" : "Voir le score"}
          </button>
        </>
      )}
    </div>
  );
}
