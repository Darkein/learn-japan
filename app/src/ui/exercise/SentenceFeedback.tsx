import { useEffect, useMemo, useState } from "react";
import { annotateTokens, type RubySegment } from "../../lib/furigana";
import { tokenize, type KuromojiToken } from "../../lib/tokenizer";
import { speakSentence, stopSentence } from "../../lib/tts";
import { Button } from "../kit/Button";
import { IconSpeaker } from "../kit/Icon";
import { Ruby } from "../Ruby";

interface Props {
  /** Phrase JA brute — tokenisée async pour les furigana (motif JpText). */
  ja?: string;
  /** Tokens déjà disponibles (mode build) : furigana synchrones, pas de re-tokenisation. */
  tokens?: KuromojiToken[];
  /** Traduction FR, affichée sous la phrase quand elle existe. */
  fr?: string;
  /** Traduction à la demande (bouton « Traduire ») quand `fr` manque. */
  onTranslate?: () => Promise<string | null>;
}

/**
 * Phrase de correction d'un exercice : furigana toujours révélés (moment d'étude),
 * bouton d'écoute (Cloud TTS avec repli Web Speech) et traduction FR — stockée, ou
 * générée à la demande via `onTranslate`.
 */
export function SentenceFeedback({ ja, tokens, fr, onTranslate }: Props) {
  const text = tokens?.length ? tokens.map((t) => t.surface_form).join("") : (ja ?? "");
  const preAnnotated = useMemo(
    () => (tokens?.length ? annotateTokens(tokens).flatMap((t) => t.segments) : null),
    [tokens],
  );
  const [segments, setSegments] = useState<RubySegment[] | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    if (preAnnotated || !text.trim()) return;
    let cancelled = false;
    void tokenize(text).then((toks) => {
      if (!cancelled) setSegments(annotateTokens(toks).flatMap((t) => t.segments));
    });
    return () => {
      cancelled = true;
    };
  }, [text, preAnnotated]);

  // Carte suivante / démontage : coupe la lecture en cours.
  useEffect(() => () => stopSentence(), []);

  if (!text.trim()) return null;

  const frLine = fr ?? translated;

  async function listen() {
    setSpeaking(true);
    try {
      await speakSentence(text);
    } finally {
      setSpeaking(false);
    }
  }

  async function translate() {
    if (!onTranslate) return;
    setTranslating(true);
    try {
      setTranslated((await onTranslate()) ?? null);
    } catch {
      setTranslated(null);
    } finally {
      setTranslating(false);
    }
  }

  const shown = preAnnotated ?? segments;

  return (
    <div className="w-full max-w-md rounded-sm border border-hairline bg-bg px-4 py-3 text-left">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-jp text-lg leading-relaxed text-text">
          {shown ? <Ruby segments={shown} reveal /> : text}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => void listen()}
          active={speaking}
          aria-label="Écouter la phrase"
          title="Écouter la phrase"
        >
          <IconSpeaker size={18} />
        </Button>
      </div>
      {frLine ? (
        <div className="mt-0.5 font-sans text-sm text-muted">{frLine}</div>
      ) : (
        onTranslate && (
          <button
            className="mt-1 cursor-pointer font-sans text-sm text-muted underline disabled:cursor-default"
            onClick={() => void translate()}
            disabled={translating}
          >
            {translating ? "Traduction…" : "Traduire"}
          </button>
        )
      )}
    </div>
  );
}
