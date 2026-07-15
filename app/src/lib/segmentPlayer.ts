// Moteur de lecture des segments podcast (sans React) : joue une suite de PodcastSegment
// en continu — audio Cloud TTS (mis en cache par ttsClient), blancs de réponse
// (`pauseAfterMs`), jeton d'exécution pour invalider les continuations annulées.
// L'état React (contexte, reprise, MediaSession) vit dans ui/usePodcastPlayer.tsx.
//
// Fiabilité écran éteint (mobile) : tout passe par un UNIQUE élément <audio> persistant,
// amorcé pendant un geste utilisateur (verrou d'autoplay porté par l'instance, comme le
// keeper d'audioFocus.ts). Segments MP3, blancs de quiz (WAV silencieux de la bonne durée)
// et attentes réseau/génération (silence en boucle) s'y enchaînent via `onended` : l'OS
// voit un flux audio continu d'un seul lecteur — pas de suspension de page, pas de rejet
// d'autoplay à la frontière de segment, notification média stable. Le seul setTimeout
// restant est le repli dégradé d'un blanc dont la lecture a été refusée.
//
// Toute erreur de synthèse (Worker sans clé TTS compris) remonte via `onError` et stoppe
// la chaîne : la lecture repose exclusivement sur le TTS cloud généré.

import { primeAudioFocus } from "./audioFocus";
import { segmentParts, type PodcastSegment } from "./podcastScript";
import { silentWavUrl } from "./silentWav";
import { synthesizeParts, synthesizeSentence } from "./ttsClient";

/** Durée du silence de maintien bouclé (fetch TTS, changement de piste). */
const HOLD_SILENCE_MS = 8000;

export function tokenAtTime(marks: { i: number; t: number }[], t: number): number | null {
  let cur: number | null = null;
  for (const m of marks) if (t >= m.t) cur = m.i;
  return cur;
}

export interface SegmentPlayerCallbacks {
  /** Le segment `index` démarre (mettre à jour l'UI : index courant, progression à 0). */
  onSegmentStart: (index: number) => void;
  /** Avancement (0..1) du segment en cours. */
  onProgress: (p: number) => void;
  /** Erreur de synthèse : la chaîne est stoppée, l'UI affiche le message. */
  onError: (message: string) => void;
  /** Token courant surligné (index global) pour un segment histoire, null sinon. */
  onToken: (index: number | null) => void;
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
  /** Mémorise un décalage (0..1) DANS le prochain segment démarré (reprise après scrub en pause). */
  primeSeek: (frac: number) => void;
  /** (Re)lance la lecture au segment donné, éventuellement à un décalage (0..1) dans ce segment. */
  start: (fromIndex: number, offset?: number) => void;
  /**
   * À appeler SYNCHRONIQUEMENT pendant le geste utilisateur qui déclenchera (souvent après
   * des await) une lecture : joue un silence bouclé sur l'élément persistant pour capturer
   * le verrou d'autoplay et garder la session audio OS active pendant la préparation.
   */
  prime: () => void;
  /** Pause EN PLACE : l'élément reste chargé, la notification média persiste. */
  pause: () => void;
  /** Reprend là où `pause()` s'est arrêté, ou relance le segment courant sinon. */
  resume: () => void;
  /** Coupe la chaîne mais maintient un silence bouclé (changement de piste en cours de lecture). */
  standby: () => void;
  /** Coupe la lecture en cours, décharge l'élément (libère le focus OS) et invalide tout. */
  halt: () => void;
  /** Position absolue dans le segment courant (null pendant un blanc). */
  getPosition: () => { currentTime: number; duration: number } | null;
}

export function createSegmentPlayer(cb: SegmentPlayerCallbacks): SegmentPlayer {
  let run = 0; // jeton d'exécution : invalide les continuations annulées
  let segments: PodcastSegment[] = [];
  let index = 0;
  let audio: HTMLAudioElement | null = null; // singleton persistant (jamais recréé, cf. en-tête)
  let url: string | null = null; // object URL du segment en cours (les WAV silencieux sont mémoïsés ailleurs)
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let seekOffset = 0; // décalage (0..1) à appliquer au prochain segment démarré
  // Ce que l'élément joue : un segment réel, un blanc de quiz, le silence de maintien, rien.
  let clipKind: "segment" | "gap" | "hold" | "idle" = "idle";
  let pausedInPlace = false; // pause() sans teardown : resume() repart au même endroit
  let prefetching = false; // une seule pré-synthèse en vol

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
    }
    return audio;
  }

  function clearTimers(): void {
    if (pauseTimer) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
  }

  function revokeUrl(): void {
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
  }

  /** Silence bouclé sur l'élément persistant (maintien de la session audio OS). */
  function holdSilence(): void {
    const el = ensureAudio();
    el.onended = null;
    el.ontimeupdate = null;
    el.loop = true;
    clipKind = "hold";
    el.src = silentWavUrl(HOLD_SILENCE_MS);
    revokeUrl();
    void el.play().catch(() => {
      /* autoplay refusé (élément jamais amorcé par un geste) — la lecture réelle retentera */
    });
  }

  /** Coupe le silence de maintien (erreur de synthèse) sans toucher au reste. */
  function stopHold(): void {
    if (!audio || clipKind !== "hold") return;
    audio.pause();
    audio.loop = false;
    audio.removeAttribute("src");
    audio.load();
    clipKind = "idle";
  }

  // Décharge la source + reset (pas juste pause) : sur Chrome/Android, un <audio> Blob
  // laissé en pause sans être déchargé peut garder le focus audio OS actif — donc le
  // ducking du volume système — jusqu'au ramassage par le GC. On ne décharge qu'à l'arrêt
  // définitif (halt) : l'INSTANCE est conservée, elle porte le verrou geste de l'autoplay.
  function unloadAudio(): void {
    clearTimers();
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.ontimeupdate = null;
      audio.loop = false;
      audio.removeAttribute("src");
      audio.load();
    }
    clipKind = "idle";
    revokeUrl();
  }

  function halt(): void {
    run++;
    pausedInPlace = false;
    unloadAudio();
  }

  /** Comme halt(), mais garde un silence bouclé : la session audio OS survit au changement de piste. */
  function standby(): void {
    run++;
    pausedInPlace = false;
    clearTimers();
    holdSilence();
  }

  // Avance après un segment (en respectant un éventuel blanc de réponse de quiz).
  function afterSegment(i: number, r: number): void {
    if (r !== run) return;
    const seg = segments[i];
    const go = () => {
      if (r === run) playFrom(i + 1, r);
    };
    if (!seg?.pauseAfterMs) {
      go();
      return;
    }
    // Blanc audio-piloté : un WAV silencieux de la durée voulue joué dans le même
    // élément — la chaîne reste tirée par `onended`, jamais par un timer throttlable.
    const el = ensureAudio();
    el.ontimeupdate = null;
    el.onended = go;
    el.loop = false;
    clipKind = "gap";
    el.src = silentWavUrl(seg.pauseAfterMs);
    revokeUrl();
    void el.play().catch(() => {
      // Repli dégradé (lecture refusée) : timer classique, throttlable en arrière-plan.
      pauseTimer = setTimeout(go, seg.pauseAfterMs);
    });
  }

  // Pré-synthèse du segment suivant, résultat ignoré : l'effet utile est de réchauffer le
  // cache IndexedDB de ttsClient (hit instantané au moment de jouer → pas de trou audio).
  // Aucune interaction avec le jeton `run`, erreurs avalées : c'est le playSegment du
  // segment courant qui fait remonter les échecs.
  function prefetch(i: number): void {
    if (prefetching) return;
    const seg = segments[i];
    if (!seg) return;
    prefetching = true;
    const p: Promise<unknown> = seg.tokens
      ? synthesizeSentence(seg.tokens, seg.baseTokenIndex ?? 0)
      : synthesizeParts(segmentParts(seg));
    void p
      .catch(() => undefined)
      .finally(() => {
        prefetching = false;
      });
  }

  async function playSegment(i: number, r: number): Promise<void> {
    const seg = segments[i];
    if (!seg) return;
    // Démarrage à froid (reprise, seek en pause) : maintenir un silence pendant la synthèse
    // pour que l'OS garde la session audio active (les enchaînements, eux, jouent déjà).
    const el = ensureAudio();
    if (el.paused) holdSilence();
    let blob: Blob;
    let marks: { i: number; t: number }[] = [];
    try {
      if (seg.tokens) {
        const out = await synthesizeSentence(seg.tokens, seg.baseTokenIndex ?? 0);
        blob = out.audio;
        marks = out.marks;
      } else {
        blob = await synthesizeParts(segmentParts(seg));
      }
    } catch (e) {
      if (r !== run) return;
      stopHold();
      cb.onError(String(e instanceof Error ? e.message : e));
      return;
    }
    if (r !== run) return;
    const old = url;
    url = URL.createObjectURL(blob);
    el.loop = false;
    clipKind = "segment";
    el.src = url;
    if (old) URL.revokeObjectURL(old);
    // Reprise proportionnelle (scrub barre d'avancement) : positionne dans le timeline
    // du segment avant lecture. Appliqué une seule fois, puis remis à zéro pour que les
    // segments suivants repartent bien de leur début.
    if (seekOffset > 0) {
      const off = seekOffset;
      seekOffset = 0;
      const apply = () => {
        if (el.duration && isFinite(el.duration)) el.currentTime = Math.min(off * el.duration, el.duration - 0.05);
      };
      if (el.readyState >= 1) apply();
      else el.addEventListener("loadedmetadata", apply, { once: true });
    }
    el.onended = () => afterSegment(i, r);
    el.ontimeupdate = () => {
      if (r !== run) return;
      const d = el.duration;
      if (d && isFinite(d) && d > 0) cb.onProgress(Math.min(1, el.currentTime / d));
      if (marks.length) cb.onToken(tokenAtTime(marks, el.currentTime));
    };
    try {
      await el.play();
    } catch (e) {
      // AbortError (src remplacé par une continuation plus récente) et NotAllowedError
      // (autoplay bloqué, géré par toggle côté UI) sont attendus ; le reste doit remonter
      // — c'était avalé avant, et la chaîne mourait sans bruit en arrière-plan.
      if (r === run) {
        const name = e instanceof DOMException ? e.name : "";
        if (name !== "AbortError" && name !== "NotAllowedError")
          cb.onError(String(e instanceof Error ? e.message : e));
      }
    }
    prefetch(i + 1);
  }

  // Joue le segment i (fin de pack → onEnded : enchaînement / boucle côté appelant).
  function playFrom(i: number, r: number): void {
    if (r !== run) return;
    if (i >= segments.length) {
      // Dernier segment terminé : silence de maintien pendant que l'appelant décide de la
      // suite (piste suivante → standby prend le relais ; stop → halt() coupe tout).
      holdSilence();
      cb.onEnded();
      return;
    }
    index = i;
    cb.onSegmentStart(i);
    if (!segments[i]?.tokens) cb.onToken(null);
    void playSegment(i, r);
  }

  return {
    setSegments: (s) => {
      segments = s;
      pausedInPlace = false;
    },
    hasSegments: () => segments.length > 0,
    index: () => index,
    setIndex: (i) => {
      index = i;
      pausedInPlace = false;
    },
    primeSeek: (frac) => {
      seekOffset = Math.min(Math.max(frac, 0), 1);
      pausedInPlace = false;
    },
    start: (fromIndex, offset) => {
      if (offset != null) seekOffset = Math.min(Math.max(offset, 0), 1);
      pausedInPlace = false;
      clearTimers();
      primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
      const el = ensureAudio();
      if (el.paused) holdSilence(); // couvre la synthèse du premier segment
      playFrom(fromIndex, ++run);
    },
    prime: () => {
      if (pausedInPlace) return; // ne pas écraser une pause en place (reprise via resume())
      const el = ensureAudio();
      if (el.paused) holdSilence();
    },
    pause: () => {
      if (pauseTimer) {
        // Blanc en repli dégradé (timer) : on fige en annulant la continuation ; la reprise
        // relancera le segment courant via start().
        run++;
        clearTimers();
        return;
      }
      const el = audio;
      if (el && (clipKind === "segment" || clipKind === "gap") && el.getAttribute("src")) {
        // Pause EN PLACE : élément chargé, jeton `run` intact (les closures onended/ontimeupdate
        // restent valides) — resume() = simple play(), la phrase ne repart pas du début, et la
        // notification média de l'écran verrouillé persiste en état « pause ».
        el.pause();
        pausedInPlace = true;
      } else {
        // Rien de « pausable » (silence de maintien, synthèse en vol) : on invalide la
        // continuation et on coupe le silence — la reprise repartira du segment courant.
        run++;
        stopHold();
      }
    },
    resume: () => {
      if (pausedInPlace && audio?.getAttribute("src")) {
        pausedInPlace = false;
        void audio.play().catch(() => {
          /* refus inattendu : l'UI reste pilotable via toggle */
        });
        return;
      }
      pausedInPlace = false;
      primeAudioFocus();
      const el = ensureAudio();
      if (el.paused) holdSilence();
      playFrom(index, ++run);
    },
    standby,
    halt,
    getPosition: () => {
      if (!audio || clipKind !== "segment") return null;
      const d = audio.duration;
      if (!d || !isFinite(d) || d <= 0) return null;
      return { currentTime: audio.currentTime, duration: d };
    },
  };
}
