// Couche TTS du lecteur.
//  - speakWord : lecture d'un mot via la Web Speech API du navigateur (offline, zéro quota).
//  - useArticlePlayer : lecture de l'article ENTIER, phrase par phrase, via Cloud TTS (Worker)
//    avec surlignage du mot en cours grâce aux timepoints SSML. Repli automatique sur la Web
//    Speech API (surlignage approximatif via onboundary) si le Worker n'a pas de clé TTS.
//
// Granularité « par phrase » : borne la taille des requêtes, permet le cache et le
// préchargement de la phrase suivante, et pose la base du mode voiture (SPEC §11-12).

import { useCallback, useEffect, useRef, useState } from "react";
import { buildSilentWavBlob, nudgeAudioFocusRelease, primeAudioFocus } from "./audioFocus";
import type { AnnotatedToken } from "./furigana";
import { synthesizeSentence, synthesizeText, TtsUnconfiguredError } from "./ttsClient";

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

/**
 * Lit un mot (ou une courte chaîne) en japonais via la Web Speech API. La promesse se
 * résout à la FIN de l'énoncé (ou tout de suite si la synthèse n'est pas supportée), afin
 * que l'appelant puisse afficher un état « lecture en cours » sur toute la durée réelle.
 */
export function speakWord(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSupported() || !text.trim()) return resolve();
    primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
    window.speechSynthesis.cancel(); // coupe toute lecture en cours
    const u = new SpeechSynthesisUtterance(text);
    u.lang = JA_LANG;
    const v = pickJaVoice();
    if (v) u.voice = v;
    const done = () => {
      nudgeAudioFocusRelease();
      resolve();
    };
    u.onend = done;
    u.onerror = done; // utterance interrompue/échouée : même libération
    window.speechSynthesis.speak(u);
  });
}

// ---------- Lecture d'une phrase à la demande (correction d'exercice) --------

let sentenceAudio: HTMLAudioElement | null = null;

// Le Worker a répondu « pas de clé TTS » (503) : inutile de retenter un aller-retour
// réseau à chaque phrase. On passe alors DIRECTEMENT à la voix du navigateur, de façon
// SYNCHRONE dans le geste utilisateur (voir speakSentence) — sinon l'attente réseau
// consommerait l'activation utilisateur et le repli serait muet sur mobile.
let ttsUnavailable = false;

// URL d'un court silence, créée une seule fois. Sert à « bénir » un <audio> pendant un
// geste utilisateur : un élément média ayant joué lors d'un geste garde ensuite le droit
// de jouer HORS geste (permission par élément, persistante), contrairement à un élément
// neuf. C'est la clé du correctif des exemples muets (cf. speakSentence).
let silentUrl: string | null = null;
function silentPrimeUrl(): string {
  return (silentUrl ??= URL.createObjectURL(buildSilentWavBlob()));
}

/**
 * Décharge complètement un <audio> Blob (pause + source retirée + reset). Un élément
 * simplement mis en pause et déréférencé peut, sur Chrome/Android, garder ses ressources
 * média (et le focus audio OS, donc le ducking du volume système) tant qu'il n'est pas
 * ramassé par le GC — ce qui peut prendre un moment, voire ne jamais survenir tant que
 * l'utilisateur reste sur la page. Vider `src` + `load()` force Chromium à relâcher
 * immédiatement le lecteur média sous-jacent.
 */
function unloadAudio(audio: HTMLAudioElement): void {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

/** Coupe la lecture de phrase en cours (audio Cloud ET Web Speech). */
export function stopSentence(): void {
  // Nudge seulement si une synthèse tournait vraiment : stopSentence est aussi appelée
  // au démontage de chaque carte d'exercice et au début de chaque lecture.
  const speechActive =
    speechSupported() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  if (sentenceAudio) {
    unloadAudio(sentenceAudio);
    sentenceAudio = null;
  }
  if (speechSupported()) window.speechSynthesis.cancel();
  if (speechActive) nudgeAudioFocusRelease();
  releaseMediaSession();
}

/**
 * Lit une phrase entière : Cloud TTS (cache IndexedDB partagé avec le lecteur) si le
 * Worker est configuré, sinon repli Web Speech. La promesse se résout à la FIN de la
 * lecture (ou dès qu'elle est coupée / échoue), pour que l'appelant puisse afficher un
 * indicateur « lecture en cours » pendant toute la durée réelle du son.
 */
export async function speakSentence(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  stopSentence();
  primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture

  // Worker déjà connu sans clé TTS → repli voix du navigateur SYNCHRONE (dans le geste),
  // sans aller-retour réseau. Décisif sur mobile : un speak() lancé après une attente est
  // hors geste et donc muet, alors que speakWord ici garde l'activation utilisateur.
  if (ttsUnavailable) {
    await speakWord(clean);
    return;
  }

  // On crée l'élément MAINTENANT (dans le geste) et on le « bénit » par une lecture
  // silencieuse : le fetch Cloud TTS ci-dessous consomme l'activation utilisateur, si bien
  // qu'un <audio> créé après coup verrait son play() refusé par l'autoplay mobile (d'où des
  // exemples muets alors que les mots, joués en plein geste, s'entendent). Béni, l'élément
  // garde le droit de jouer même une fois le blob récupéré, hors geste.
  const audio = typeof Audio !== "undefined" ? new Audio() : null;
  if (audio) {
    audio.src = silentPrimeUrl();
    audio.play().catch(() => {
      /* amorçage refusé (pas de geste réel) — le changement de src plus bas l'interrompt */
    });
  }

  let blob: Blob;
  try {
    blob = await synthesizeText(clean, "ja");
  } catch (e) {
    // Worker sans clé TTS (503) → on retient l'info pour repli direct ensuite ; injoignable
    // → repli ponctuel. Dans les deux cas : voix du navigateur (résout en fin d'énoncé).
    if (e instanceof TtsUnconfiguredError) ttsUnavailable = true;
    if (audio) unloadAudio(audio);
    releaseMediaSession(); // annule l'éventuel playbackState "playing" posé avant l'échec
    await speakWord(clean);
    return;
  }
  if (!audio) {
    // Environnement sans HTMLAudioElement (SSR / tests) → voix du navigateur.
    await speakWord(clean);
    return;
  }
  const url = URL.createObjectURL(blob);
  audio.src = url;
  sentenceAudio = audio;
  setSpokenMediaSessionMeta();
  setMediaSessionPlaybackState("playing");
  await new Promise<void>((resolve) => {
    let settled = false;
    const release = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      unloadAudio(audio);
      if (sentenceAudio === audio) sentenceAudio = null;
      releaseMediaSession();
      resolve();
    };
    audio.onended = release;
    // Lecture interrompue (stopSentence, carte suivante) ou source vidée : `error` couvre
    // aussi le `load()` d'unloadAudio, ce qui garantit la résolution de la promesse.
    audio.onerror = release;
    audio.play().catch(() => {
      // Lecture refusée (autoplay) → repli voix du navigateur, puis résolution.
      release();
      void speakWord(clean);
    });
  });
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

function mediaSessionAvailable(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/** Pose le titre affiché sur l'écran de verrouillage / notification média. */
function setSpokenMediaSessionMeta(): void {
  if (!mediaSessionAvailable()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: "Lecture", artist: "Learn Japan" });
  } catch {
    /* MediaMetadata indisponible — ignore */
  }
}

function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  if (!mediaSessionAvailable()) return;
  navigator.mediaSession.playbackState = state;
}

/**
 * Libère complètement la session média OS (playbackState "none" + metadata vidée).
 * Sans ça, Chrome considère qu'un média reste actif même après la fin réelle de la
 * lecture, ce qui maintient le ducking du volume système jusqu'à la fermeture du
 * navigateur.
 */
function releaseMediaSession(): void {
  setMediaSessionPlaybackState("none");
  if (!mediaSessionAvailable()) return;
  try {
    navigator.mediaSession.metadata = null;
  } catch {
    /* ignore */
  }
}

export function useArticlePlayer(sentences: PlayerSentence[], rate = 1): ArticlePlayer {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTokenIndex, setCurrentTokenIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // État impératif (évite les closures périmées dans les handlers audio/parole).
  const sentencesRef = useRef(sentences);
  sentencesRef.current = sentences;
  // Vitesse de lecture courante : lue impérativement par les chemins audio/parole, et
  // appliquée à chaud à l'élément <audio> en cours via l'effet plus bas.
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const idxRef = useRef(0); // phrase courante
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const marksRef = useRef<{ i: number; t: number }[]>([]);
  const modeRef = useRef<Mode>("cloud");
  const runRef = useRef(0); // jeton d'exécution : invalide les callbacks d'une lecture annulée

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      unloadAudio(audioRef.current);
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
    if (speechSupported()) {
      // Nudge seulement si une synthèse tournait vraiment : stop() est aussi appelé au
      // démontage du hook et à chaque changement d'article.
      const speechActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
      window.speechSynthesis.cancel();
      if (speechActive) nudgeAudioFocusRelease();
    }
    setPlaying(false);
    setLoading(false);
    setCurrentTokenIndex(null);
    releaseMediaSession();
  }, [cleanupAudio]);

  // Repli Web Speech : lit une phrase, surligne le mot via onboundary (charIndex).
  const speakSentence = useCallback((idx: number, run: number) => {
    const list = sentencesRef.current;
    if (run !== runRef.current) return;
    if (idx >= list.length) {
      cleanupAudio();
      setPlaying(false);
      setCurrentTokenIndex(null);
      releaseMediaSession();
      if (modeRef.current === "speech") nudgeAudioFocusRelease();
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
    u.rate = rateRef.current;
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
    // Utterance en échec (moteur TTS indisponible, interruption) : sans ce handler la
    // chaîne s'arrête net, `playing` reste vrai et le focus audio n'est jamais relâché.
    u.onerror = () => {
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
        cleanupAudio();
        setPlaying(false);
        setCurrentTokenIndex(null);
        releaseMediaSession();
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
      // playbackRate accélère/ralentit sans toucher au timeline du média : les
      // timepoints (marks, exprimés dans ce timeline) restent alignés et l'audio
      // mis en cache est réutilisé quelle que soit la vitesse.
      audio.playbackRate = rateRef.current;
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
      primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
      setSpokenMediaSessionMeta();
      setMediaSessionPlaybackState("playing");
      if (modeRef.current === "speech") speakSentence(fromIdx, run);
      else void playCloud(fromIdx, run);
    },
    [playCloud, speakSentence],
  );

  const pause = useCallback(() => {
    runRef.current++; // fige les continuations
    if (modeRef.current === "speech") {
      if (speechSupported()) {
        const speechActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        window.speechSynthesis.cancel();
        if (speechActive) nudgeAudioFocusRelease();
      }
    } else if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlaying(false);
    setLoading(false);
    setMediaSessionPlaybackState("paused");
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

  // Changement de vitesse en cours de lecture : applique à chaud à l'<audio> Cloud TTS.
  // (Le repli Web Speech ne sait pas changer de débit en plein mot → la nouvelle
  // vitesse s'appliquera à la phrase suivante.)
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  // Nettoyage au démontage.
  useEffect(() => () => stop(), [stop]);

  // MediaSession : contrôles média OS / Bluetooth / volant (fondation mode voiture).
  // Le playbackState/metadata sont gérés explicitement par start/pause/stop (voir
  // releaseMediaSession) plutôt que par un effet réactif à `playing`, pour éviter que la
  // session média OS reste active ("playing"/"paused") après la fin réelle de la lecture —
  // ce qui maintiendrait le ducking du volume système jusqu'à la fermeture du navigateur.
  useEffect(() => {
    if (!mediaSessionAvailable()) return;
    const ms = navigator.mediaSession;
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
