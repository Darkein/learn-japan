// Moteur de lecture des segments podcast (sans React) : joue une suite de PodcastSegment
// en continu — audio Cloud TTS (mis en cache par ttsClient) avec repli Web Speech, blancs
// de réponse (`pauseAfterMs`), jeton d'exécution pour invalider les continuations annulées.
// L'état React (contexte, reprise, MediaSession) vit dans ui/usePodcastPlayer.tsx.

import { nudgeAudioFocusRelease, primeAudioFocus } from "./audioFocus";
import type { PodcastSegment } from "./podcastScript";
import { synthesizeText, TtsUnconfiguredError } from "./ttsClient";

const LANG_TAG: Record<PodcastSegment["lang"], string> = { fr: "fr-FR", ja: "ja-JP" };

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: PodcastSegment["lang"]): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const pref = lang === "fr" ? "fr" : "ja";
  return window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(pref)) ?? null;
}

export interface SegmentPlayerCallbacks {
  /** Le segment `index` démarre (mettre à jour l'UI : index courant, progression à 0). */
  onSegmentStart: (index: number) => void;
  /** Avancement (0..1) du segment en cours (temps réel en cloud, estimé en Web Speech). */
  onProgress: (p: number) => void;
  /** Erreur de synthèse (hors « TTS non configuré », qui bascule sur Web Speech). */
  onError: (message: string) => void;
  /** Fin du dernier segment (enchaîner sur la leçon suivante / boucler). */
  onEnded: () => void;
}

export interface SegmentPlayer {
  setSegments: (segments: PodcastSegment[]) => void;
  hasSegments: () => boolean;
  /** Index du segment courant (persiste en pause, sert à la reprise). */
  index: () => number;
  /** Positionne l'index sans lancer la lecture (navigation en pause). */
  setIndex: (i: number) => void;
  /** Repart en mode Cloud TTS (nouveau pack) après un éventuel repli Web Speech. */
  resetMode: () => void;
  /** (Re)lance la lecture au segment donné. */
  start: (fromIndex: number) => void;
  /** Coupe la lecture en cours et invalide toute continuation en vol. */
  halt: () => void;
}

export function createSegmentPlayer(cb: SegmentPlayerCallbacks): SegmentPlayer {
  let run = 0; // jeton d'exécution : invalide les continuations annulées
  let segments: PodcastSegment[] = [];
  let index = 0;
  let mode: "cloud" | "speech" = "cloud";
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let speechTimer: ReturnType<typeof setInterval> | null = null;

  function cleanupAudio(): void {
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    if (speechTimer) {
      clearInterval(speechTimer);
      speechTimer = null;
    }
    if (audio) {
      // Vide la source + reset (pas juste pause) : sur Chrome/Android, un <audio> Blob
      // laissé en pause sans être déchargé peut garder le focus audio OS actif — donc le
      // ducking du volume système — jusqu'au ramassage par le GC (potentiellement jamais
      // tant que la page reste ouverte).
      audio.pause();
      audio.onended = null;
      audio.removeAttribute("src");
      audio.load();
      audio = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  function halt(): void {
    run++;
    cleanupAudio();
    if (speechSupported()) {
      // Nudge seulement si une synthèse tournait vraiment : halt() est aussi appelé au
      // démontage du provider et avant chaque chargement de leçon.
      const speechActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
      window.speechSynthesis.cancel();
      if (speechActive) nudgeAudioFocusRelease();
    }
  }

  // Avance après un segment (en respectant un éventuel blanc de réponse de quiz).
  function afterSegment(i: number, r: number): void {
    if (r !== run) return;
    const seg = segments[i];
    const go = () => {
      if (r === run) playFrom(i + 1, r);
    };
    if (seg?.pauseAfterMs) {
      pauseTimer = setTimeout(go, seg.pauseAfterMs);
    } else {
      go();
    }
  }

  function speakSegment(i: number, r: number): void {
    const seg = segments[i];
    if (!seg) return;
    if (!speechSupported()) {
      afterSegment(i, r); // pas de parole dispo → on enchaîne (au moins les pauses)
      return;
    }
    const u = new SpeechSynthesisUtterance(seg.text);
    u.lang = LANG_TAG[seg.lang];
    const v = pickVoice(seg.lang);
    if (v) u.voice = v;
    // Pas d'événement de progression natif en Web Speech : estimation par durée/débit de lecture.
    const estMs = Math.max(400, (seg.text.length / 5) * 1000);
    const startedAt = Date.now();
    if (speechTimer) clearInterval(speechTimer);
    speechTimer = setInterval(() => {
      if (r !== run) return;
      cb.onProgress(Math.min(1, (Date.now() - startedAt) / estMs));
    }, 150);
    const done = () => {
      if (speechTimer) {
        clearInterval(speechTimer);
        speechTimer = null;
      }
      afterSegment(i, r);
    };
    u.onend = done;
    // Utterance en échec (moteur TTS indisponible, interruption) : sans ce handler la
    // chaîne s'arrête net et le timer de progression fuit.
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  async function playCloud(i: number, r: number): Promise<void> {
    const seg = segments[i];
    if (!seg) return;
    let blob: Blob;
    try {
      blob = await synthesizeText(seg.text, seg.lang);
    } catch (e) {
      if (r !== run) return;
      if (e instanceof TtsUnconfiguredError) {
        mode = "speech"; // bascule tout le pack sur la Web Speech API
        speakSegment(i, r);
        return;
      }
      cb.onError(String(e instanceof Error ? e.message : e));
      return;
    }
    if (r !== run) return;
    cleanupAudio();
    url = URL.createObjectURL(blob);
    const el = new Audio(url);
    audio = el;
    el.onended = () => afterSegment(i, r);
    el.ontimeupdate = () => {
      if (r !== run) return;
      const d = el.duration;
      if (d && isFinite(d) && d > 0) cb.onProgress(Math.min(1, el.currentTime / d));
    };
    try {
      await el.play();
    } catch {
      /* lecture coupée / autoplay bloqué — géré par toggle/close côté UI */
    }
  }

  // Joue le segment i (fin de pack → onEnded : enchaînement / boucle côté appelant).
  function playFrom(i: number, r: number): void {
    if (r !== run) return;
    if (i >= segments.length) {
      cleanupAudio(); // dernier segment terminé : décharge son <audio> avant d'enchaîner
      if (mode === "speech" && speechSupported()) nudgeAudioFocusRelease();
      cb.onEnded();
      return;
    }
    index = i;
    cb.onSegmentStart(i);
    if (mode === "speech") speakSegment(i, r);
    else void playCloud(i, r);
  }

  return {
    setSegments: (s) => {
      segments = s;
    },
    hasSegments: () => segments.length > 0,
    index: () => index,
    setIndex: (i) => {
      index = i;
    },
    resetMode: () => {
      mode = "cloud";
    },
    start: (fromIndex) => {
      primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
      playFrom(fromIndex, ++run);
    },
    halt,
  };
}
