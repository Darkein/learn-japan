// Moteur de lecture des segments podcast (sans React) : joue une suite de PodcastSegment
// en continu — audio Cloud TTS (mis en cache par ttsClient) avec repli Web Speech, blancs
// de réponse (`pauseAfterMs`), jeton d'exécution pour invalider les continuations annulées.
// L'état React (contexte, reprise, MediaSession) vit dans ui/usePodcastPlayer.tsx.
//
// Fiabilité écran éteint (mobile) : tout passe par un UNIQUE élément <audio> persistant,
// amorcé pendant un geste utilisateur (verrou d'autoplay porté par l'instance, comme le
// keeper d'audioFocus.ts). Segments MP3, blancs de quiz (WAV silencieux de la bonne durée)
// et attentes réseau/génération (silence en boucle) s'y enchaînent via `onended` : l'OS
// voit un flux audio continu d'un seul lecteur — pas de suspension de page, pas de rejet
// d'autoplay à la frontière de segment, notification média stable. Les setTimeout, eux,
// sont throttlés voire gelés écran éteint (ils ne subsistent qu'en mode Web Speech et en
// repli dégradé).

import { nudgeAudioFocusRelease, primeAudioFocus } from "./audioFocus";
import type { PodcastSegment } from "./podcastScript";
import { silentWavUrl } from "./silentWav";
import { synthesizeSentence, synthesizeText, TtsUnconfiguredError, TtsUnreachableError } from "./ttsClient";

const LANG_TAG: Record<PodcastSegment["lang"], string> = { fr: "fr-FR", ja: "ja-JP" };

/** Durée du silence de maintien bouclé (fetch TTS, changement de piste). */
const HOLD_SILENCE_MS = 8000;

export function tokenAtTime(marks: { i: number; t: number }[], t: number): number | null {
  let cur: number | null = null;
  for (const m of marks) if (t >= m.t) cur = m.i;
  return cur;
}

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: PodcastSegment["lang"]): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const pref = lang === "fr" ? "fr" : "ja";
  return window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(pref)) ?? null;
}

// Sur Android, `getVoices()` renvoie [] au premier appel : la liste se peuple de façon
// ASYNCHRONE (event `voiceschanged`), et une toute première `speak()` émise avant ce
// chargement est souvent avalée en silence — d'où des segments qui « défilent » sans son
// au démarrage à froid, écran éteint compris. On amorce donc le chargement tôt (pendant le
// geste) et on offre une attente courte avant de parler.
function warmVoices(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.getVoices(); // déclenche le peuplement asynchrone
  } catch {
    /* ignore */
  }
}

/** Résout dès que des voix sont disponibles (ou après `timeoutMs`, pour ne jamais bloquer). */
function voicesReady(timeoutMs = 1500): Promise<void> {
  if (!speechSupported()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener?.("voiceschanged", finish);
      resolve();
    };
    window.speechSynthesis.addEventListener?.("voiceschanged", finish);
    window.speechSynthesis.getVoices();
    setTimeout(finish, timeoutMs);
  });
}

export interface SegmentPlayerCallbacks {
  /** Le segment `index` démarre (mettre à jour l'UI : index courant, progression à 0). */
  onSegmentStart: (index: number) => void;
  /** Avancement (0..1) du segment en cours (temps réel en cloud, estimé en Web Speech). */
  onProgress: (p: number) => void;
  /** Erreur de synthèse (hors « TTS non configuré », qui bascule sur Web Speech). */
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
  /** Repart en mode Cloud TTS (nouveau pack) après un éventuel repli Web Speech. */
  resetMode: () => void;
  /** (Re)lance la lecture au segment donné, éventuellement à un décalage (0..1) dans ce segment. */
  start: (fromIndex: number, offset?: number) => void;
  /**
   * À appeler SYNCHRONIQUEMENT pendant le geste utilisateur qui déclenchera (souvent après
   * des await) une lecture : joue un silence bouclé sur l'élément persistant pour capturer
   * le verrou d'autoplay et garder la session audio OS active pendant la préparation.
   */
  prime: () => void;
  /** Pause EN PLACE (cloud) : l'élément reste chargé, la notification média persiste. */
  pause: () => void;
  /** Reprend là où `pause()` s'est arrêté, ou relance le segment courant sinon. */
  resume: () => void;
  /** Coupe la chaîne mais maintient un silence bouclé (changement de piste en cours de lecture). */
  standby: () => void;
  /** Coupe la lecture en cours, décharge l'élément (libère le focus OS) et invalide tout. */
  halt: () => void;
  /** Position absolue dans le segment courant (cloud uniquement, null pendant un blanc). */
  getPosition: () => { currentTime: number; duration: number } | null;
}

export function createSegmentPlayer(cb: SegmentPlayerCallbacks): SegmentPlayer {
  let run = 0; // jeton d'exécution : invalide les continuations annulées
  let segments: PodcastSegment[] = [];
  let index = 0;
  let mode: "cloud" | "speech" = "cloud";
  let audio: HTMLAudioElement | null = null; // singleton persistant (jamais recréé, cf. en-tête)
  let url: string | null = null; // object URL du segment en cours (les WAV silencieux sont mémoïsés ailleurs)
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let speechTimer: ReturnType<typeof setInterval> | null = null;
  let seekOffset = 0; // décalage (0..1) à appliquer au prochain segment cloud démarré
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
    if (speechTimer) {
      clearInterval(speechTimer);
      speechTimer = null;
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

  /**
   * Garde un <audio> silencieux en boucle PENDANT la Web Speech : sans média « en lecture »,
   * l'OS ne montre pas de notification média et suspend la page écran éteint (la synthèse
   * vocale y est alors gelée). Ce silence, joué sur l'élément persistant amorcé par un geste,
   * maintient la session audio OS active → notification affichée et lecture qui survit à
   * l'écran éteint. Idempotent : ne relance pas le silence s'il tourne déjà (pas de trou).
   */
  function keepSpeechSession(): void {
    const el = ensureAudio();
    if (clipKind !== "hold" || el.paused) holdSilence();
  }

  /** Coupe le silence de maintien (bascule Web Speech, erreur) sans toucher au reste. */
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

  function cancelSpeech(): void {
    if (!speechSupported()) return;
    // Nudge seulement si une synthèse tournait vraiment : halt() est aussi appelé au
    // démontage du provider et avant chaque chargement de leçon.
    const speechActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    window.speechSynthesis.cancel();
    if (speechActive) nudgeAudioFocusRelease();
  }

  function halt(): void {
    run++;
    pausedInPlace = false;
    unloadAudio();
    cancelSpeech();
  }

  /** Comme halt(), mais garde un silence bouclé : la session audio OS survit au changement de piste. */
  function standby(): void {
    run++;
    pausedInPlace = false;
    clearTimers();
    cancelSpeech();
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
    if (mode === "cloud" && audio) {
      // Blanc audio-piloté : un WAV silencieux de la durée voulue joué dans le même
      // élément — la chaîne reste tirée par `onended`, jamais par un timer throttlable.
      const el = audio;
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
    } else {
      pauseTimer = setTimeout(go, seg.pauseAfterMs);
    }
  }

  function speakSegment(i: number, r: number): void {
    const seg = segments[i];
    if (!seg) return;
    if (!speechSupported()) {
      afterSegment(i, r); // pas de parole dispo → on enchaîne (au moins les pauses)
      return;
    }
    // Silence de maintien actif pendant toute la Web Speech : notification média + survie
    // écran éteint (cf. keepSpeechSession). Couvre aussi l'éventuelle attente des voix.
    keepSpeechSession();

    const emit = () => {
      if (r !== run) return; // annulé pendant l'attente des voix
      const u = new SpeechSynthesisUtterance(seg.text);
      u.lang = LANG_TAG[seg.lang];
      const v = pickVoice(seg.lang);
      if (v) u.voice = v;
      if (seg.tokens) {
        const offsets: number[] = [];
        let acc = 0;
        for (const t of seg.tokens) {
          offsets.push(acc);
          acc += t.length;
        }
        const base = seg.baseTokenIndex ?? 0;
        u.onboundary = (e) => {
          if (r !== run) return;
          let local = 0;
          for (let k = 0; k < offsets.length; k++) if (e.charIndex >= offsets[k]) local = k;
          cb.onToken(base + local);
        };
      }
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
    };

    // Démarrage à froid (Android) : `getVoices()` peut être vide au premier segment et une
    // toute première `speak()` émise avant le chargement des voix est souvent avalée sans
    // son (segments qui défilent muets). On attend alors brièvement leur disponibilité.
    if (window.speechSynthesis.getVoices().length === 0) void voicesReady().then(emit);
    else emit();
  }

  // Pré-synthèse du segment suivant, résultat ignoré : l'effet utile est de réchauffer le
  // cache IndexedDB de ttsClient (hit instantané au moment de jouer → pas de trou audio).
  // Aucune interaction avec le jeton `run`, erreurs avalées (y compris TtsUnconfiguredError :
  // c'est le playCloud du segment courant qui décide de la bascule Web Speech).
  function prefetch(i: number): void {
    if (prefetching || mode !== "cloud") return;
    const seg = segments[i];
    if (!seg) return;
    prefetching = true;
    const p: Promise<unknown> = seg.tokens
      ? synthesizeSentence(seg.tokens, seg.baseTokenIndex ?? 0)
      : synthesizeText(seg.text, seg.lang);
    void p
      .catch(() => undefined)
      .finally(() => {
        prefetching = false;
      });
  }

  async function playCloud(i: number, r: number): Promise<void> {
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
        blob = await synthesizeText(seg.text, seg.lang);
      }
    } catch (e) {
      if (r !== run) return;
      // TTS non configuré (503) OU Worker injoignable (hors-ligne, timeout) : dans les DEUX
      // cas on bascule le pack sur la Web Speech API, seule option sans réseau. Hors-ligne on
      // ne peut pas obtenir le 503, donc sans ce second cas la lecture partait en impasse
      // d'erreur au lieu de parler. On garde le silence de maintien (pas de stopHold) : il
      // porte la session média OS pour la Web Speech (écran éteint, notification).
      if (e instanceof TtsUnconfiguredError || e instanceof TtsUnreachableError) {
        mode = "speech";
        speakSegment(i, r);
        return;
      }
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
      // suite (piste suivante → standby prend le relais ; stop → halt() coupe tout). En mode
      // speech aussi on garde ce silence : la session média OS survit au passage à la piste
      // suivante (écran éteint). Le vrai relâchement du focus se fait dans halt() (cancelSpeech).
      holdSilence();
      cb.onEnded();
      return;
    }
    index = i;
    cb.onSegmentStart(i);
    if (!segments[i]?.tokens) cb.onToken(null);
    if (mode === "speech") speakSegment(i, r);
    else void playCloud(i, r);
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
    resetMode: () => {
      mode = "cloud";
    },
    start: (fromIndex, offset) => {
      if (offset != null) seekOffset = Math.min(Math.max(offset, 0), 1);
      pausedInPlace = false;
      clearTimers();
      primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
      warmVoices(); // amorce le chargement des voix (repli Web Speech hors-ligne)
      const el = ensureAudio();
      if (el.paused) holdSilence(); // couvre la synthèse du premier segment
      playFrom(fromIndex, ++run);
    },
    prime: () => {
      warmVoices(); // pendant le geste : voix prêtes si repli Web Speech (hors-ligne)
      if (pausedInPlace) return; // ne pas écraser une pause en place (reprise via resume())
      const el = ensureAudio();
      if (el.paused) holdSilence();
    },
    pause: () => {
      if (mode === "speech") {
        // Pas de pause en place possible en Web Speech : arrêt complet (comportement historique).
        halt();
        return;
      }
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
      warmVoices();
      const el = ensureAudio();
      if (el.paused) holdSilence();
      playFrom(index, ++run);
    },
    standby,
    halt,
    getPosition: () => {
      if (mode !== "cloud" || !audio || clipKind !== "segment") return null;
      const d = audio.duration;
      if (!d || !isFinite(d) || d <= 0) return null;
      return { currentTime: audio.currentTime, duration: d };
    },
  };
}
