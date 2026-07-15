import { useEffect, useMemo, useRef, useState } from "react";
import { annotateTokens, type RubySegment } from "../../lib/furigana";
import { tokenize, type KuromojiToken } from "../../lib/tokenizer";
import { speakSentence, speakWord, stopSentence } from "../../lib/tts";
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
 * Bouton d'écoute de la correction quand l'exercice n'a pas de phrase de contexte
 * (kanji, mot isolé, point de grammaire) : joue le mot ou la phrase fournis via
 * `Exercise.audioBack` (Web Speech — offline, contenu arbitraire).
 */
export function AudioBackButton({ audio }: { audio: { word?: string; sentence?: string } }) {
  const [speaking, setSpeaking] = useState(false);
  const token = useRef(0);

  // Démontage : coupe la lecture en cours (sinon focus audio OS orphelin).
  useEffect(() => () => stopSentence(), []);

  async function listen() {
    const my = ++token.current;
    setSpeaking(true);
    try {
      if (audio.sentence) await speakSentence(audio.sentence);
      else if (audio.word) await speakWord(audio.word);
    } finally {
      if (token.current === my) setSpeaking(false);
    }
  }

  return (
    <Button
      variant="ghost"
      onClick={() => void listen()}
      active={speaking}
      aria-label="Écouter"
    >
      <IconSpeaker size={16} />
      {speaking ? "Lecture…" : "Écouter"}
    </Button>
  );
}

/**
 * Phrase de correction d'un exercice : furigana toujours révélés (moment d'étude),
 * bouton d'écoute (Web Speech) et traduction FR — stockée, ou générée à la demande
 * via `onTranslate`.
 */
export function SentenceFeedback({ ja, tokens, fr, onTranslate }: Props) {
  const text = tokens?.length ? tokens.map((t) => t.surface_form).join("") : (ja ?? "");
  const preAnnotated = useMemo(
    () => (tokens?.length ? annotateTokens(tokens).flatMap((t) => t.segments) : null),
    [tokens],
  );
  const [segments, setSegments] = useState<RubySegment[] | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const speakToken = useRef(0);
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
    // Jeton par appel : un rejeu pendant la lecture ne doit pas voir l'ancien appel (coupé
    // par le nouveau) éteindre l'indicateur — seul le dernier appel pilote `speaking`.
    const my = ++speakToken.current;
    setSpeaking(true);
    try {
      await speakSentence(text);
    } finally {
      if (speakToken.current === my) setSpeaking(false);
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
