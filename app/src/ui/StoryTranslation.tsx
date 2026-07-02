import { useEffect, useState } from "react";
import type { GenState } from "../lib/genClient";
import { splitJaSentences } from "../lib/kana";
import { ensureStoryTranslationById } from "../lib/podcast";

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "…",
};

interface Props {
  /** Identifiant de l'histoire en base (cache la traduction). Absent pour une lecture libre. */
  storyId?: string;
  text: string;
  level: number;
}

/**
 * Traduction française fluide (la « vraie » traduction, ≠ gloss mot-à-mot), alignée phrase JP /
 * phrase FR — la « 2e écoute » écrite. Masquée par défaut côté lecteur (montée seulement à la
 * révélation) ; réutilise le cache partagé avec le mode podcast (`StoryRecord.translation`).
 */
export function StoryTranslation({ storyId, text, level }: Props) {
  const [sentences, setSentences] = useState<string[] | null>(null);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGenState("generating");
    ensureStoryTranslationById(storyId, text, level)
      .then((t) => {
        if (cancelled) return;
        setGenState("ready");
        setSentences(t.sentences);
        if (t.sentences.length === 0) setError("Traduction indisponible pour cette histoire.");
      })
      .catch((e) => {
        if (cancelled) return;
        setGenState("error");
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Régénère si l'histoire change ; les autres props sont stables pour une histoire donnée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, text]);

  const card = "flex flex-col gap-3 rounded-md border border-hairline bg-surface px-4 py-6";

  if (error) {
    return (
      <div className={card}>
        <p className="text-sm text-accent">{error}</p>
      </div>
    );
  }

  if (!sentences) {
    return (
      <div className={card}>
        <p className="text-sm text-muted">
          Traduction française… {genState ? STATE_LABEL[genState] : ""}
        </p>
      </div>
    );
  }

  const ja = splitJaSentences(text);

  return (
    <div className={card}>
      <span className="text-xs uppercase tracking-wider text-muted">Traduction française</span>
      <ol className="flex list-none flex-col gap-3">
        {ja.map((sentence, k) => (
          <li key={k} className="flex flex-col gap-0.5">
            <span className="font-jp text-sm text-muted">{sentence}</span>
            {sentences[k] && <span className="text-text">{sentences[k]}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
