// Couche TTS du lecteur.
//  - speakWord : lecture d'un mot via la Web Speech API du navigateur (offline, zéro quota).
//  - useArticlePlayer : lecture de l'article ENTIER, phrase par phrase, via Cloud TTS (Worker)
//    avec surlignage du mot en cours grâce aux timepoints SSML. Repli automatique sur la Web
//    Speech API (surlignage approximatif via onboundary) si le Worker n'a pas de clé TTS.
//
// Granularité « par phrase » : borne la taille des requêtes, permet le cache et le
// préchargement de la phrase suivante, et pose la base du mode voiture (SPEC §11-12).

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnnotatedToken } from "./furigana";
import { synthesizeSentence, TtsUnconfiguredError } from "./ttsClient";

// ---------- Web Speech : lecture d'un mot ------------------------------------

const JA_LANG = "ja-JP";

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Choisit une voix japonaise si le navigateur en propose une (sinon, défaut système). */
function pickJaVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith("ja")) ?? null;
}

/** Lit un mot (ou une courte chaîne) en japonais via la Web Speech API. */
export function speakWord(text: string): void {
  if (!speechSupported() || !text.trim()) return;
  window.speechSynthesis.cancel(); // coupe toute lecture en cours
  const u = new SpeechSynthesisUtterance(text);
  u.lang = JA_LANG;
  const v = pickJaVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

// ---------- Segmentation en phrases ------------------------------------------

const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "．", "\n"]);

export interface PlayerSentence {
  segments: string[]; // surfaces des tokens de la phrase
  baseIndex: number; // index GLOBAL du 1er token (pour le surlignage)
  text: string; // = segments.join("") (repli Web Speech)
}

/**
 * Groupe les tokens analysés en phrases : on coupe APRÈS un token de ponctuation
 * finale. Chaque phrase conserve l'index global de ses tokens.
 */
export function splitSentences(tokens: AnnotatedToken[]): PlayerSentence[] {
  const out: PlayerSentence[] = [];
  let cur: string[] = [];
  let base = 0;
  tokens.forEach((tok, i) => {
    if (cur.length === 0) base = i;
    cur.push(tok.surface);
    const isEnd = [...tok.surface].some((ch) => SENTENCE_END.has(ch));
    if (isEnd) {
      out.push({ segments: cur, baseIndex: base, text: cur.join("") });
      cur = [];
    }
  });
  if (cur.length) out.push({ segments: cur, baseIndex: base, text: cur.join("") });
  return out.filter((s) => s.text.trim().length > 0);
}

// ---------- Hook player : article entier -------------------------------------

export interface ArticlePlayer {
  playing: boolean;
  loading: boolean;
  /** Index GLOBAL du token actuellement prononcé, ou null. */
  currentTokenIndex: number | null;
  error: string | null;
  available: boolean;
  toggle: () => void;
  stop: () => void;
}

type Mode = "cloud" | "speech";

export function useArticlePlayer(sentences: PlayerSentence[]): ArticlePlayer {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTokenIndex, setCurrentTokenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État impératif (évite les closures périmées dans les handlers audio/parole).
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;
  const idxRef = useRef(0); // phrase courante
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const marksRef = useRef<{ i: number; t: number }[]>([]);
  const modeRef = useRef<Mode>("cloud");
  const runRef = useRef(0); // jeton d'exécution : invalide les callbacks d'une lecture annulée

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.ontimeupdate = null;
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    runRef.current++; // invalide toute continuation en vol
    cleanupAudio();
    if (speechSupported()) window.speechSynthesis.cancel();
    setPlaying(false);
    setLoading(false);
    setCurrentTokenIndex(null);
  }, [cleanupAudio]);

  // Repli Web Speech : lit une phrase, surligne le mot via onboundary (charIndex).
  const speakSentence = useCallback((idx: number, run: number) => {
    const list = sentencesRef.current;
    if (run !== runRef.current) return;
    if (idx >= list.length) {
      setPlaying(false);
      setCurrentTokenIndex(null);
      return;
    }
    idxRef.current = idx;
    const s = list[idx];
    // Offsets de début de chaque token dans le texte de la phrase.
    const offsets: number[] = [];
    let acc = 0;
    for (const seg of s.segments) {
      offsets.push(acc);
      acc += seg.length;
    }
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = JA_LANG;
    const v = pickJaVoice();
    if (v) u.voice = v;
    u.onboundary = (e) => {
      if (run !== runRef.current) return;
      let local = 0;
      for (let k = 0; k < offsets.length; k++) if (e.charIndex >= offsets[k]) local = k;
      setCurrentTokenIndex(s.baseIndex + local);
    };
    u.onend = () => {
      if (run !== runRef.current) return;
      speakSentence(idx + 1, run);
    };
    setLoading(false);
    window.speechSynthesis.speak(u);
  }, []);

  // Chemin Cloud TTS : audio MP3 + timepoints, phrase par phrase, avec préchargement.
  const playCloud = useCallback(
    async (idx: number, run: number) => {
      const list = sentencesRef.current;
      if (run !== runRef.current) return;
      if (idx >= list.length) {
        setPlaying(false);
        setCurrentTokenIndex(null);
        return;
      }
      idxRef.current = idx;
      const s = list[idx];
      setLoading(true);
      let res;
      try {
        res = await synthesizeSentence(s.segments, s.baseIndex);
      } catch (e) {
        if (run !== runRef.current) return;
        // Pas de clé TTS → on bascule tout l'article sur la Web Speech API.
        if (e instanceof TtsUnconfiguredError) {
          modeRef.current = "speech";
          speakSentence(idx, run);
          return;
        }
        setError(String(e instanceof Error ? e.message : e));
        stop();
        return;
      }
      if (run !== runRef.current) return;

      cleanupAudio();
      const url = URL.createObjectURL(res.audio);
      urlRef.current = url;
      marksRef.current = res.marks;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.ontimeupdate = () => {
        const marks = marksRef.current;
        const t = audio.currentTime;
        let cur: number | null = null;
        for (const m of marks) if (t >= m.t) cur = m.i;
        if (cur !== null) setCurrentTokenIndex(cur);
      };
      audio.onended = () => {
        if (run !== runRef.current) return;
        void playCloud(idx + 1, run);
      };
      setLoading(false);
      try {
        await audio.play();
      } catch {
        /* l'utilisateur a coupé / autoplay bloqué — état géré par stop/toggle */
      }
    },
    [cleanupAudio, speakSentence, stop],
  );

  const start = useCallback(
    (fromIdx: number) => {
      const run = ++runRef.current;
      setError(null);
      setPlaying(true);
      if (modeRef.current === "speech") speakSentence(fromIdx, run);
      else void playCloud(fromIdx, run);
    },
    [playCloud, speakSentence],
  );

  const pause = useCallback(() => {
    runRef.current++; // fige les continuations
    if (modeRef.current === "speech") {
      if (speechSupported()) window.speechSynthesis.cancel();
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlaying(false);
    setLoading(false);
  }, []);

  const toggle = useCallback(() => {
    if (!sentencesRef.current.length) return;
    if (playing) {
      // Reprise propre : on relit la phrase courante depuis son début.
      pause();
    } else {
      start(idxRef.current);
    }
  }, [playing, pause, start]);

  // Nouvel article → on réinitialise tout.
  useEffect(() => {
    stop();
    idxRef.current = 0;
    modeRef.current = "cloud";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentences]);

  // Nettoyage au démontage.
  useEffect(() => () => stop(), [stop]);

  // MediaSession : contrôles média OS / Bluetooth / volant (fondation mode voiture).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: "Lecture", artist: "Learn Japan" });
    } catch {
      /* MediaMetadata indisponible — ignore */
    }
    ms.setActionHandler("play", () => start(idxRef.current));
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("stop", () => stop());
    ms.setActionHandler("nexttrack", () => start(Math.min(idxRef.current + 1, sentences.length - 1)));
    ms.setActionHandler("previoustrack", () => start(Math.max(idxRef.current - 1, 0)));
    return () => {
      for (const a of ["play", "pause", "stop", "nexttrack", "previoustrack"] as const) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [start, pause, stop, sentences.length]);

  // Reflète l'état play/pause vers l'OS (icône des contrôles média).
  useEffect(() => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing]);

  return {
    playing,
    loading,
    currentTokenIndex,
    error,
    available: speechSupported() || sentences.length > 0,
    toggle,
    stop,
  };
}
