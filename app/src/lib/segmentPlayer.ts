// Moteur de lecture des segments podcast (sans React) : joue une suite de PodcastSegment
// en continu — audio Cloud TTS (mis en cache par ttsClient), blancs de réponse
// (`pauseAfterMs`), jeton d'exécution pour invalider les continuations annulées.
// L'état React (contexte, reprise, MediaSession) vit dans ui/usePodcastPlayer.tsx.
//
// Fiabilité écran éteint (mobile) : un UNIQUE élément <audio> persistant lit un FLUX
// CONTINU MediaSource (`audio/mpeg`) dans lequel tout est appondu bout à bout — MP3 des
// segments, blancs de quiz et tampon d'attente en silence MP3 du même format (24 kHz,
// cf. silentMp3.ts). La lecture ne s'arrête donc JAMAIS aux frontières de segments :
// aucun changement de `src`, aucun nouveau `play()` hors geste utilisateur. C'est ce qui
// répare la coupure écran éteint : Chromium classe tout média de MOINS DE 5 SECONDES en
// session « transient » (pas de notification média, focus audio fugace), or les phrases
// synthétisées durent souvent moins de 5 s — enchaînées comme clips séparés, Android
// retirait la notification puis refusait le play() suivant en arrière-plan. Un flux
// MediaSource ouvert (durée infinie) est traité comme un vrai contenu long.
//
// La position dans le flux est reprojetée sur les segments via une liste de RÉGIONS
// ([début, fin) en secondes de flux, remplie au fil des appends) : progression,
// surlignage des tokens (timepoints) et fin de piste dérivent de `currentTime` seul —
// aucun setTimeout throttlable, tout est piloté par `timeupdate` et `updateend`.
//
// Toute erreur de synthèse (Worker sans clé TTS compris) remonte via `onError` après une
// relance, et stoppe la chaîne : la lecture repose exclusivement sur le TTS cloud généré.

import { segmentParts, type PodcastSegment } from "./podcastScript";
import { silentMp3Bytes } from "./silentMp3";
import { synthesizeParts, synthesizeSentence } from "./ttsClient";

/** Synthétiser tant que le flux a moins d'avance que ça sur la tête de lecture (s). */
const SYNTH_AHEAD_S = 20;
/** En dessous de cette avance (s), apponder du silence pour ne jamais assécher le flux. */
const LOW_WATER_S = 3;
/** Taille d'un bloc de silence tampon (ms). */
const HOLD_CHUNK_MS = 1000;
/** Purge du passé : au-delà de ce retard bufferisé (s), on supprime… */
const TRIM_AT_S = 120;
/** …tout ce qui précède la tête de lecture de plus de ce délai (s). */
const TRIM_KEEP_S = 60;
/** Délai (s de flux joué) avant la relance unique d'une synthèse échouée. */
const RETRY_AFTER_S = 2;

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
   * des await) une lecture : attache le flux et démarre le silence tampon pour capturer
   * le verrou d'autoplay et garder la session audio OS active pendant la préparation.
   */
  prime: () => void;
  /** Pause EN PLACE : le flux reste attaché, la notification média persiste. */
  pause: () => void;
  /** Reprend là où `pause()` s'est arrêté, ou relance le segment courant sinon. */
  resume: () => void;
  /** Coupe la chaîne mais maintient le silence tampon (changement de piste en cours de lecture). */
  standby: () => void;
  /** Coupe la lecture en cours, détache le flux (libère le focus OS) et invalide tout. */
  halt: () => void;
  /** Position absolue dans le segment courant (null pendant un blanc). */
  getPosition: () => { currentTime: number; duration: number } | null;
}

/** Portion [start, end) du flux : à quel contenu correspond ce temps de lecture. */
interface Region {
  kind: "segment" | "gap" | "hold";
  run: number; // génération qui l'a appondue (les callbacks ignorent les régions périmées)
  segIndex: number; // pour kind === "segment"
  marks: { i: number; t: number }[];
  start: number;
  end: number;
}

/** Élément prêt à être appondu au flux (synthèse résolue ou silence). */
interface Clip {
  kind: Region["kind"];
  run: number;
  segIndex: number;
  marks: { i: number; t: number }[];
  bytes: Uint8Array;
  /** Dernier contenu de sa génération : sa fin de région devient la fin de piste. */
  last?: boolean;
}

export function createSegmentPlayer(cb: SegmentPlayerCallbacks): SegmentPlayer {
  let run = 0; // jeton d'exécution : invalide synthèses et régions des générations annulées
  let segments: PodcastSegment[] = [];
  let index = 0;
  let seekOffset = 0; // décalage (0..1) à appliquer au prochain segment démarré
  let pausedInPlace = false; // pause() sans teardown : resume() = simple play()

  // --- Flux MediaSource -------------------------------------------------------
  let el: HTMLAudioElement | null = null; // singleton persistant (porte le verrou geste)
  let ms: MediaSource | null = null;
  let sb: SourceBuffer | null = null;
  let streamEnd = 0; // fin (s) du dernier append : point d'ancrage du suivant
  let regions: Region[] = [];
  let appendQueue: Clip[] = [];
  let pendingAppend: Clip | null = null; // append en cours (attribué à sa région à l'updateend)
  let cutAt: number | null = null; // purge du futur demandée (changement de piste / seek)

  // --- Génération courante (une par start(), tuée par standby/halt/erreur) ----
  let genActive = false;
  let genNext = 0; // prochain segment à synthétiser
  let genContentEnd: number | null = null; // fin (s de flux) du dernier contenu appondu
  let genEndedFired = false;
  let synthInFlight = false;
  let retryUsed = false;
  let retryAt: number | null = null; // relance quand la tête de lecture atteint ce temps
  let emittedSeg = -1; // dernier onSegmentStart émis (générationnel, remis par start())
  let jumpOffset: number | null = null; // saut vers le 1er segment appondu de la génération

  function ensureAudio(): HTMLAudioElement {
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      el.ontimeupdate = onTimeUpdate;
      el.onerror = () => {
        if (genActive) cb.onError("Erreur de lecture du flux audio.");
      };
    }
    return el;
  }

  /** Attache un flux MediaSource neuf si l'élément n'en porte pas déjà un d'ouvert. */
  function ensureStream(): void {
    const a = ensureAudio();
    if (ms && ms.readyState !== "closed") return;
    if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported("audio/mpeg")) {
      cb.onError("Lecture audio en continu non supportée par ce navigateur (MediaSource MP3).");
      return;
    }
    const m = new MediaSource();
    ms = m;
    sb = null;
    streamEnd = 0;
    regions = [];
    const url = URL.createObjectURL(m);
    m.addEventListener(
      "sourceopen",
      () => {
        URL.revokeObjectURL(url);
        if (ms !== m) return; // flux remplacé entre-temps (halt puis redémarrage)
        sb = m.addSourceBuffer("audio/mpeg");
        try {
          sb.mode = "sequence"; // implicite pour audio/mpeg, explicité par sûreté
        } catch {
          /* certains moteurs refusent la réaffectation : le mode est déjà "sequence" */
        }
        sb.addEventListener("updateend", onUpdateEnd);
        pump();
      },
      { once: true },
    );
    a.src = url;
  }

  /** `play()` dont seuls Abort/NotAllowed (attendus) sont avalés — le reste remonte. */
  function tryPlay(a: HTMLAudioElement): void {
    void a.play().catch((e) => {
      const name = e instanceof DOMException ? e.name : "";
      if (name !== "AbortError" && name !== "NotAllowedError")
        cb.onError(String(e instanceof Error ? e.message : e));
    });
    // Relance la pompe : une reprise sur un flux asséché ne produit aucun `timeupdate`
    // (tête immobile), c'est donc ici que le tampon de silence doit repartir.
    pump();
  }

  function bufferedEnd(): number {
    const b = sb?.buffered;
    return b && b.length ? b.end(b.length - 1) : streamEnd;
  }

  function currentTime(): number {
    return el ? el.currentTime : 0;
  }

  /** Région du flux sous la tête de lecture (la plus récente qui la contient). */
  function regionAt(t: number): Region | null {
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i];
      if (t >= r.start && t < r.end) return r;
    }
    return null;
  }

  // --- Pompe d'alimentation du flux -------------------------------------------
  // Point d'entrée unique de toute mutation du SourceBuffer, relancée par `updateend`,
  // `timeupdate` et les résolutions de synthèse. Une seule opération à la fois.
  function pump(): void {
    if (!sb || !ms || ms.readyState !== "open" || sb.updating) return;
    const t = currentTime();

    // 1. Purge du futur (changement de piste / seek) : coupe l'audio pas encore joué.
    if (cutAt != null) {
      const cut = Math.max(cutAt, t + 0.1);
      cutAt = null;
      if (bufferedEnd() > cut) {
        streamEnd = cut;
        regions = regions.filter((r) => r.start < cut);
        for (const r of regions) if (r.end > cut) r.end = cut;
        sb.remove(cut, Number.POSITIVE_INFINITY);
        return; // updateend relance la pompe
      }
    }

    // 2. Purge du passé : borne la mémoire du buffer sur les longues écoutes.
    const b = sb.buffered;
    if (b.length && t - b.start(0) > TRIM_AT_S) {
      const keepFrom = t - TRIM_KEEP_S;
      regions = regions.filter((r) => r.end > keepFrom);
      sb.remove(0, keepFrom);
      return;
    }

    // 3. Contenu prêt (segment synthétisé, blanc de quiz) : appondre.
    const next = appendQueue.shift();
    if (next) {
      append(next);
      return;
    }

    // 4. Synthèse du segment suivant si l'avance est insuffisante.
    scheduleSynthesis(t);

    // 5. Presque à sec (synthèse en vol, changement de piste, fin de file) : silence
    //    tampon pour que le flux — donc la session audio OS — ne s'arrête jamais.
    if (el && !el.paused && streamEnd - t < LOW_WATER_S) {
      append({ kind: "hold", run, segIndex: -1, marks: [], bytes: silentMp3Bytes(HOLD_CHUNK_MS) });
    }
  }

  function append(clip: Clip): void {
    if (!sb) return;
    pendingAppend = clip;
    try {
      sb.timestampOffset = streamEnd; // mode sequence : ancre le groupe qui suit
    } catch {
      /* parseur au milieu d'un segment : le mode sequence garantit déjà la continuité */
    }
    try {
      sb.appendBuffer(clip.bytes as BufferSource);
    } catch (e) {
      pendingAppend = null;
      if (e instanceof DOMException && e.name === "QuotaExceededError" && el) {
        // Buffer plein : purge agressive du passé puis nouvelle tentative via la pompe.
        appendQueue.unshift(clip);
        const keepFrom = el.currentTime - 10;
        if (keepFrom > 0 && !sb.updating) {
          regions = regions.filter((r) => r.end > keepFrom);
          sb.remove(0, keepFrom);
        }
        return;
      }
      cb.onError(String(e instanceof Error ? e.message : e));
    }
  }

  function onUpdateEnd(): void {
    const clip = pendingAppend;
    pendingAppend = null;
    if (clip) {
      const end = bufferedEnd();
      // Append d'une génération tuée APRÈS la demande de coupe (il était déjà en vol) :
      // ses octets sont dans le buffer sans région — programmer leur purge.
      if (clip.run !== run && end > streamEnd && cutAt == null) cutAt = currentTime();
      if (clip.run === run && end > streamEnd) {
        regions.push({ kind: clip.kind, run: clip.run, segIndex: clip.segIndex, marks: clip.marks, start: streamEnd, end });
        if (clip.kind !== "hold" && clip.last) genContentEnd = end;
        // Premier segment de la génération : saut de la tête de lecture par-dessus le
        // silence tampon accumulé, directement au décalage demandé dans le segment.
        if (clip.kind === "segment" && jumpOffset != null && el) {
          const target = streamEnd + jumpOffset * (end - streamEnd);
          jumpOffset = null;
          el.currentTime = Math.min(target, end - 0.05);
        }
      }
      if (end > streamEnd) streamEnd = end;
    }
    pump();
  }

  // --- Synthèse ---------------------------------------------------------------
  async function synthClip(seg: PodcastSegment): Promise<{ bytes: Uint8Array; marks: { i: number; t: number }[] }> {
    if (seg.tokens) {
      const out = await synthesizeSentence(seg.tokens, seg.baseTokenIndex ?? 0);
      return { bytes: new Uint8Array(await out.audio.arrayBuffer()), marks: out.marks };
    }
    const blob = await synthesizeParts(segmentParts(seg));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), marks: [] };
  }

  function scheduleSynthesis(t: number): void {
    if (!genActive || synthInFlight || genNext >= segments.length) return;
    if (streamEnd - t >= SYNTH_AHEAD_S) return;
    if (retryAt != null && t < retryAt) return;
    retryAt = null;
    const i = genNext;
    const seg = segments[i];
    const r = run;
    synthInFlight = true;
    void (async () => {
      try {
        const { bytes, marks } = await synthClip(seg);
        if (r !== run) return;
        genNext = i + 1;
        retryUsed = false;
        const isLast = genNext >= segments.length;
        appendQueue.push({ kind: "segment", run: r, segIndex: i, marks, bytes, last: isLast && !seg.pauseAfterMs });
        if (seg.pauseAfterMs)
          appendQueue.push({ kind: "gap", run: r, segIndex: i, marks: [], bytes: silentMp3Bytes(seg.pauseAfterMs), last: isLast });
      } catch (e) {
        if (r !== run) return;
        if (!retryUsed) {
          // Relance unique (réseau mobile capricieux, écran éteint) : le silence tampon
          // maintient le flux pendant l'attente, la pompe retente à `retryAt`.
          retryUsed = true;
          retryAt = currentTime() + RETRY_AFTER_S;
        } else {
          genActive = false;
          el?.pause();
          cb.onError(String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (r === run) {
          synthInFlight = false;
          pump();
        }
      }
    })();
  }

  // --- Suivi de la tête de lecture ---------------------------------------------
  function onTimeUpdate(): void {
    const t = currentTime();
    const reg = regionAt(t);
    if (reg && reg.run === run && genActive && reg.kind === "segment") {
      if (reg.segIndex !== emittedSeg) {
        emittedSeg = reg.segIndex;
        index = reg.segIndex;
        cb.onSegmentStart(reg.segIndex);
        if (!reg.marks.length) cb.onToken(null);
      }
      const d = reg.end - reg.start;
      if (d > 0) cb.onProgress(Math.min(1, (t - reg.start) / d));
      if (reg.marks.length) cb.onToken(tokenAtTime(reg.marks, t - reg.start));
    }
    // Fin de piste : tout le contenu est appondu et la tête a dépassé sa fin.
    if (genActive && !genEndedFired && genContentEnd != null && t >= genContentEnd - 0.05) {
      genEndedFired = true;
      cb.onEnded();
    }
    pump();
  }

  // --- Cycle de vie -------------------------------------------------------------
  /** Tue la génération en cours (synthèses invalidées, contenu futur coupé). */
  function killGeneration(): void {
    run++;
    genActive = false;
    synthInFlight = false;
    retryUsed = false;
    retryAt = null;
    appendQueue = [];
    jumpOffset = null;
    if (bufferedEnd() > currentTime()) cutAt = currentTime();
  }

  function start(fromIndex: number, offset?: number): void {
    if (offset != null) seekOffset = Math.min(Math.max(offset, 0), 1);
    pausedInPlace = false;
    killGeneration();
    genActive = true;
    genNext = fromIndex;
    genContentEnd = null;
    genEndedFired = false;
    emittedSeg = -1;
    index = fromIndex;
    jumpOffset = seekOffset;
    seekOffset = 0;
    ensureStream();
    if (!ms) return; // MediaSource indisponible : onError déjà émis par ensureStream()
    if (el?.paused) tryPlay(el);
    // Démarrage au-delà de la fin (piste vide) : fin immédiate, comme l'exigeait l'ancien
    // moteur — l'appelant enchaîne (piste suivante) ou coupe (halt).
    if (fromIndex >= segments.length) {
      genEndedFired = true;
      cb.onEnded();
      return;
    }
    pump();
  }

  function halt(): void {
    killGeneration();
    pausedInPlace = false;
    cutAt = null;
    pendingAppend = null;
    regions = [];
    streamEnd = 0;
    sb = null;
    ms = null;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
  }

  /** Comme halt(), mais garde le flux et son silence tampon : la session audio OS survit. */
  function standby(): void {
    killGeneration();
    pausedInPlace = false;
    pump();
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
    start,
    prime: () => {
      if (pausedInPlace) return; // ne pas écraser une pause en place (reprise via resume())
      ensureStream();
      if (ms && el?.paused) tryPlay(el);
    },
    pause: () => {
      if (el && ms && ms.readyState !== "closed") {
        el.pause();
        pausedInPlace = true;
      }
    },
    resume: () => {
      const wasInPlace = pausedInPlace;
      pausedInPlace = false;
      if (wasInPlace && el && genActive) {
        tryPlay(el);
        return;
      }
      start(index);
    },
    standby,
    halt,
    getPosition: () => {
      if (!el) return null;
      const reg = regionAt(el.currentTime);
      if (!reg || reg.run !== run || reg.kind !== "segment") return null;
      const d = reg.end - reg.start;
      if (d <= 0) return null;
      return { currentTime: el.currentTime - reg.start, duration: d };
    },
  };
}
