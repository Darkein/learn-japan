// Lecteur audio global et persistant (SPEC §11). Un contexte React porté au niveau de
// l'app : il survit à la navigation entre onglets/pages. Il joue une FILE d'attente de
// « pistes » (leçon ou histoire) via le moteur lib/segmentPlayer.ts. Une leçon pré-génère
// son pack (cadrage → quiz → histoire → transition) ; une histoire est analysée puis jouée
// phrase par phrase avec surlignage du token courant (timepoints TTS). En fin de piste, le
// mode de lecture décide de la suite : auto (enchaîne leçon/histoire suivante), répétition
// (reboucle la file), une fois (stop).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { analyze } from "../lib/analyze";
import { getCurriculum } from "../lib/curriculum";
import { allStories, getPodcast, getStory } from "../lib/db";
import { getLesson, markLessonStarted } from "../lib/lessons";
import { endAction, nextMode, reorder, type PlayMode, type QueueItem } from "../lib/playQueue";
import { generatePodcastPack } from "../lib/podcast";
import { activeTrackIndex, PACK_VERSION, trackEntries, type PodcastSegment } from "../lib/podcastScript";
import { createSegmentPlayer, type SegmentPlayer } from "../lib/segmentPlayer";
import { buildStorySegments } from "../lib/storyPodcast";
import { navigate } from "./useHashRoute";
import { STORY_RATES, useSettings } from "./useSettings";

const RESUME_KEY = "podcast.resume";
const AUTONAV_KEY = "podcast.autonav";

/** Chemin de la page correspondant à une piste (histoire → lecteur, leçon → cours). */
function pageForItem(item: QueueItem): string {
  const id = encodeURIComponent(item.kind === "story" ? item.storyId : item.lessonId);
  return item.kind === "story" ? `/lecture/${id}` : `/cours/${id}`;
}

interface PodcastState {
  active: boolean;
  title: string;
  segments: PodcastSegment[];
  index: number;
  /** Avancement (0..1) du segment en cours. */
  segProgress: number;
  /** Position de la leçon en cours dans le programme (curriculum), -1 si inconnue / histoire. */
  lessonIndex: number;
  lessonTotal: number;
  playing: boolean;
  /** Message de progression pendant la pré-génération (null si prêt). */
  preparing: string | null;
  error: string | null;
  queue: QueueItem[];
  /** Index de la PISTE courante dans la file. */
  queueIndex: number;
  mode: PlayMode;
  /** Token courant surligné (index global) quand la piste est une histoire, null sinon. */
  currentTokenIndex: number | null;
  /** Id de l'histoire en cours de lecture (pour le surlignage côté Reader), null si leçon. */
  activeStoryId: string | null;
  /** Suivre automatiquement la lecture en naviguant vers la page de la piste courante. */
  autoNavigate: boolean;
}

interface StoryRef {
  storyId: string;
  title: string;
}

interface PodcastApi extends PodcastState {
  startLesson: (lessonId: string) => void;
  playStory: (item: StoryRef) => void;
  enqueueStory: (item: StoryRef) => void;
  playQueueItem: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  cycleMode: () => void;
  toggleAutoNavigate: () => void;
  /** Vitesse de lecture courante (persistée, commune leçons/histoires). */
  rate: number;
  /** Passe à la vitesse suivante de STORY_RATES (boucle). */
  cycleRate: () => void;
  seekFraction: (frac: number) => void;
  /** Chemin de la page de la piste courante (null si aucune). */
  currentPage: () => string | null;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  close: () => void;
}

const PodcastContext = createContext<PodcastApi | null>(null);

const INITIAL_STATE: PodcastState = {
  active: false,
  title: "",
  segments: [],
  index: 0,
  segProgress: 0,
  lessonIndex: -1,
  lessonTotal: 0,
  playing: false,
  preparing: null,
  error: null,
  queue: [],
  queueIndex: 0,
  mode: "auto",
  currentTokenIndex: null,
  activeStoryId: null,
  autoNavigate: false,
};

export function PodcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PodcastState>(INITIAL_STATE);
  const { settings, update: updateSettings } = useSettings();
  const rate = settings.storyRate;

  // État impératif (évite les closures périmées dans les callbacks du moteur audio).
  const restoringRef = useRef(false); // reprise en cours au montage : ne pas écraser RESUME_KEY entre-temps
  const playingRef = useRef(false); // miroir de state.playing pour toggle (sans closure périmée)
  const loadTokenRef = useRef(0); // invalide une pré-génération devenue obsolète (close / relance)
  const queueRef = useRef<QueueItem[]>([]); // miroir de la file
  const qIndexRef = useRef(0); // index de la piste courante dans la file
  const modeRef = useRef<PlayMode>("auto"); // miroir du mode de lecture
  const endedRef = useRef<() => void>(() => undefined); // fin de piste (recalculée à chaque rendu)
  const autoNavRef = useRef(false); // miroir du suivi auto vers la page de la piste

  const patch = useCallback((p: Partial<PodcastState>) => setState((s) => ({ ...s, ...p })), []);

  // Pousse la position piste vers la MediaSession (recalculée à chaque rendu, cf. effet
  // MediaSession plus bas) ; appelée aussi, throttlée, depuis onProgress du moteur.
  const pushPosRef = useRef<() => void>(() => undefined);
  const lastPosPushRef = useRef(0);

  // Moteur de lecture (créé une fois ; ses callbacks ne lisent que des refs et `patch`, stables).
  const playerRef = useRef<SegmentPlayer | null>(null);
  if (!playerRef.current) {
    playerRef.current = createSegmentPlayer({
      onSegmentStart: (i) => patch({ index: i, segProgress: 0, currentTokenIndex: null }),
      onProgress: (p) => {
        patch({ segProgress: p });
        // Recale la barre de l'écran verrouillé en cours de segment (le débit réel du
        // segment n'est connu qu'une fois ses métadonnées chargées).
        const now = Date.now();
        if (now - lastPosPushRef.current > 3000) {
          lastPosPushRef.current = now;
          pushPosRef.current();
        }
      },
      onToken: (i) => patch({ currentTokenIndex: i }),
      onError: (message) => patch({ error: message, playing: false }),
      onEnded: () => endedRef.current(),
    });
  }
  const player = playerRef.current;

  const startAt = useCallback(
    (i: number, offset?: number) => {
      patch({ playing: true, error: null });
      player.start(i, offset);
    },
    [patch, player],
  );

  // Charge une piste (leçon ou histoire). `resumeIndex`/`autoplay` servent à reprendre une
  // session (après rechargement de page) sur le segment où l'on s'était arrêté.
  const loadItem = useCallback(
    async (item: QueueItem, opts?: { resumeIndex?: number; autoplay?: boolean }) => {
      const autoplay = opts?.autoplay ?? true;
      const startIndex = opts?.resumeIndex ?? 0;
      // Suivi auto : on bascule vers la page de la piste (jamais lors d'une reprise silencieuse).
      if (autoplay && autoNavRef.current) navigate(pageForItem(item));
      // En lecture : silence de maintien pendant la génération/analyse (la session audio OS
      // survit au changement de piste, même écran éteint). Restauration au montage : halt()
      // (aucun geste → un play() serait refusé de toute façon).
      if (autoplay) player.standby();
      else player.halt();
      const token = ++loadTokenRef.current;
      player.setIndex(startIndex);
      patch({
        active: true,
        playing: false,
        error: null,
        preparing: "Préparation…",
        index: startIndex,
        segProgress: 0,
        currentTokenIndex: null,
        activeStoryId: item.kind === "story" ? item.storyId : null,
      });
      try {
        if (item.kind === "lesson") {
          const lesson = await getLesson(item.lessonId);
          if (!lesson) throw new Error(`Leçon introuvable : ${item.lessonId}`);
          const order = getCurriculum();
          const idx = order.findIndex((c) => c.id === item.lessonId);
          const nextEntry = idx >= 0 ? order[idx + 1] : undefined;
          const existing = await getPodcast(item.lessonId);
          // Le lecteur démarre dès que le script est prêt ; le moteur synthétise chaque
          // segment à la demande (et précharge le suivant). La matérialisation complète de
          // l'audio reste l'affaire du téléchargement hors-ligne (download.ts).
          const pack =
            existing && existing.version === PACK_VERSION
              ? existing
              : await generatePodcastPack(item.lessonId, { nextLessonTitle: nextEntry?.title }, (msg) => {
                  if (token === loadTokenRef.current) patch({ preparing: msg });
                });
          if (token !== loadTokenRef.current) return;
          await markLessonStarted(item.lessonId);
          player.setSegments(pack.segments);
          const clamped = Math.min(startIndex, Math.max(0, pack.segments.length - 1));
          player.setIndex(clamped);
          patch({
            title: lesson.title,
            segments: pack.segments,
            preparing: null,
            index: clamped,
            lessonIndex: idx,
            lessonTotal: order.length,
          });
          if (autoplay) startAt(clamped);
        } else {
          const story = await getStory(item.storyId);
          if (!story) throw new Error(`Histoire introuvable : ${item.storyId}`);
          const analyzed = await analyze(story.text);
          if (token !== loadTokenRef.current) return;
          const segments = buildStorySegments(analyzed.tokens);
          player.setSegments(segments);
          const clamped = Math.min(startIndex, Math.max(0, segments.length - 1));
          player.setIndex(clamped);
          patch({
            title: item.title,
            segments,
            preparing: null,
            index: clamped,
            lessonIndex: -1,
            lessonTotal: 0,
          });
          if (autoplay) startAt(clamped);
        }
      } catch (e) {
        if (token === loadTokenRef.current) {
          player.halt(); // coupe le silence de maintien du standby()
          if (typeof window !== "undefined") localStorage.removeItem(RESUME_KEY);
          patch({ preparing: null, playing: false, error: String(e instanceof Error ? e.message : e) });
        }
      }
    },
    [patch, player, startAt],
  );

  const playQueueIndex = useCallback(
    (i: number) => {
      const q = queueRef.current;
      if (i < 0 || i >= q.length) return;
      player.prime(); // synchrone, pendant l'éventuel geste (verrou d'autoplay + session audio)
      qIndexRef.current = i;
      patch({ queueIndex: i });
      void loadItem(q[i], { autoplay: true });
    },
    [loadItem, patch, player],
  );

  const setQueue = useCallback(
    (q: QueueItem[]) => {
      queueRef.current = q;
      patch({ queue: q });
    },
    [patch],
  );

  // Suite à ajouter en mode « auto » quand la file est épuisée : leçon suivante du curriculum
  // ou histoire suivante de la bibliothèque (triée du plus récent au plus ancien).
  async function computeNext(last: QueueItem): Promise<QueueItem | null> {
    // Boucle sur la bibliothèque : au bout, on revient au début (radio « lecture auto »).
    // `null` seulement s'il n'existe aucune AUTRE piste que celle qui vient de finir.
    if (last.kind === "lesson") {
      const order = getCurriculum();
      const i = order.findIndex((c) => c.id === last.lessonId);
      if (i < 0 || order.length === 0) return null;
      const nxt = order[(i + 1) % order.length];
      return nxt.id === last.lessonId ? null : { kind: "lesson", lessonId: nxt.id, title: nxt.title };
    }
    const all = await allStories();
    const i = all.findIndex((s) => s.id === last.storyId);
    if (i < 0 || all.length === 0) return null;
    const nxt = all[(i + 1) % all.length];
    return nxt.id === last.storyId ? null : { kind: "story", storyId: nxt.id, title: nxt.titleFr ?? nxt.title };
  }

  async function handleEnded(): Promise<void> {
    const q = queueRef.current;
    const idx = qIndexRef.current;
    // Fin terminale (rien à enchaîner) : on rembobine la piste courante pour que « Lecture »
    // reparte du début plutôt que de rejouer la dernière phrase.
    const rewind = () => {
      player.halt(); // coupe le silence de maintien de fin de pack (vraie fin de lecture)
      player.setIndex(0);
      patch({ playing: false, index: 0, segProgress: 0, currentTokenIndex: null });
    };
    const action = endAction(modeRef.current, idx + 1 < q.length);
    if (action === "advance") return playQueueIndex(idx + 1);
    if (action === "loop") return playQueueIndex(0);
    if (action === "stop") return rewind();
    const next = await computeNext(q[q.length - 1]);
    if (!next) return rewind();
    const nq = [...q, next];
    setQueue(nq);
    playQueueIndex(nq.length - 1);
  }
  endedRef.current = () => void handleEnded();

  const startLesson = useCallback(
    (lessonId: string) => {
      player.prime(); // synchrone, pendant le geste (le then() ci-dessous en sort déjà)
      void getLesson(lessonId).then((lesson) => {
        const qi: QueueItem = { kind: "lesson", lessonId, title: lesson?.title ?? lessonId };
        setQueue([qi]);
        qIndexRef.current = 0;
        patch({ queueIndex: 0 });
        void loadItem(qi, { autoplay: true });
      });
    },
    [loadItem, patch, player, setQueue],
  );

  const playStory = useCallback(
    (item: StoryRef) => {
      player.prime(); // synchrone, pendant le geste
      const qi: QueueItem = { kind: "story", storyId: item.storyId, title: item.title };
      setQueue([qi]);
      qIndexRef.current = 0;
      patch({ queueIndex: 0 });
      void loadItem(qi, { autoplay: true });
    },
    [loadItem, patch, player, setQueue],
  );

  const enqueueStory = useCallback(
    (item: StoryRef) => {
      if (queueRef.current.length === 0) {
        playStory(item);
        return;
      }
      setQueue([...queueRef.current, { kind: "story", storyId: item.storyId, title: item.title }]);
    },
    [playStory, setQueue],
  );

  const reorderQueue = useCallback(
    (from: number, to: number) => {
      const cur = queueRef.current[qIndexRef.current];
      const nq = reorder(queueRef.current, from, to);
      qIndexRef.current = nq.indexOf(cur);
      patch({ queueIndex: qIndexRef.current });
      setQueue(nq);
    },
    [patch, setQueue],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (index === qIndexRef.current) return;
      const nq = queueRef.current.filter((_, i) => i !== index);
      if (index < qIndexRef.current) {
        qIndexRef.current -= 1;
        patch({ queueIndex: qIndexRef.current });
      }
      setQueue(nq);
    },
    [patch, setQueue],
  );

  const cycleMode = useCallback(() => {
    const m = nextMode(modeRef.current);
    modeRef.current = m;
    patch({ mode: m });
  }, [patch]);

  // Vitesse de lecture : appliquée au moteur (playbackRate du flux) dès que le réglage
  // change — effet immédiat sur la piste en cours, leçons comme histoires.
  useEffect(() => {
    player.setRate(rate);
  }, [player, rate]);

  const cycleRate = useCallback(() => {
    const i = STORY_RATES.findIndex((r) => r.value === rate);
    const next = STORY_RATES[(i + 1) % STORY_RATES.length] ?? STORY_RATES[0];
    updateSettings({ storyRate: next.value });
  }, [rate, updateSettings]);

  const toggle = useCallback(() => {
    if (!player.hasSegments()) return;
    if (playingRef.current) {
      // Pause en place (l'élément reste chargé) : la notification média persiste et la
      // reprise repart au même endroit de la phrase, pas à son début.
      player.pause();
      patch({ playing: false });
    } else {
      patch({ playing: true, error: null });
      player.resume();
    }
  }, [patch, player]);

  // Change de segment DANS la piste courante sans relancer si en pause (seul `toggle` démarre).
  const seek = useCallback(
    (i: number) => {
      if (!player.hasSegments()) return;
      const clamped = Math.min(Math.max(i, 0), state.segments.length - 1);
      if (playingRef.current) {
        startAt(clamped);
      } else {
        player.setIndex(clamped);
        patch({ index: clamped, segProgress: 0 });
      }
    },
    [patch, player, startAt, state.segments.length],
  );

  // Précédent/suivant naviguent par ÉLÉMENT de la tracklist (labels distincts — un quiz
  // entier, un paragraphe d'histoire), pas par segment brut : même granularité pour les
  // boutons de la barre du lecteur et les commandes média OS (écran verrouillé, volant).
  const stepTrack = useCallback(
    (delta: 1 | -1) => {
      const tracks = trackEntries(state.segments);
      if (!tracks.length) {
        seek(player.index() + delta);
        return;
      }
      const at = activeTrackIndex(tracks, player.index());
      seek(tracks[Math.min(tracks.length - 1, Math.max(0, at + delta))].i);
    },
    [player, seek, state.segments],
  );
  const next = useCallback(() => stepTrack(1), [stepTrack]);
  const prev = useCallback(() => stepTrack(-1), [stepTrack]);
  const jumpTo = useCallback((i: number) => seek(i), [seek]);

  // Scrub proportionnel sur toute la piste : la fraction (0..1) désigne un segment ET un
  // décalage DANS ce segment → on ne repart plus au début de la phrase.
  const seekFraction = useCallback(
    (frac: number) => {
      if (!player.hasSegments()) return;
      const n = state.segments.length;
      if (n === 0) return;
      const pos = Math.min(Math.max(frac, 0), 0.99999) * n;
      const seg = Math.min(Math.floor(pos), n - 1);
      const within = pos - seg;
      if (playingRef.current) {
        startAt(seg, within);
      } else {
        player.setIndex(seg);
        player.primeSeek(within);
        patch({ index: seg, segProgress: within });
      }
    },
    [patch, player, startAt, state.segments.length],
  );

  const playQueueItem = useCallback((i: number) => playQueueIndex(i), [playQueueIndex]);

  const toggleAutoNavigate = useCallback(() => {
    const v = !autoNavRef.current;
    autoNavRef.current = v;
    patch({ autoNavigate: v });
    if (typeof window !== "undefined") localStorage.setItem(AUTONAV_KEY, v ? "1" : "0");
  }, [patch]);

  const currentPage = useCallback(() => {
    const it = queueRef.current[qIndexRef.current];
    return it ? pageForItem(it) : null;
  }, []);

  const close = useCallback(() => {
    player.halt();
    loadTokenRef.current++;
    player.setSegments([]);
    player.setIndex(0);
    queueRef.current = [];
    qIndexRef.current = 0;
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setPositionState?.();
      } catch {
        /* ignore */
      }
    }
    setState(INITIAL_STATE);
  }, [player]);

  // Reprise après rechargement de page : réouvre la même file au même segment (sans lecture
  // auto, bloquée sans geste utilisateur).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        queue?: QueueItem[];
        qIndex?: number;
        index?: number;
        mode?: PlayMode;
        packVersion?: number;
      };
      if (saved.queue?.length) {
        restoringRef.current = true;
        queueRef.current = saved.queue;
        qIndexRef.current = saved.qIndex ?? 0;
        modeRef.current = saved.mode ?? "auto";
        patch({ queue: saved.queue, queueIndex: qIndexRef.current, mode: saved.mode ?? "auto" });
        void loadItem(saved.queue[qIndexRef.current], {
          // Un index de segment n'a de sens que dans le découpage qui l'a produit : si le
          // format de pack a changé depuis la sauvegarde, on repart du début de la piste
          // (sinon la reprise atterrit au milieu d'un contenu re-segmenté).
          resumeIndex: saved.packVersion === PACK_VERSION ? (saved.index ?? 0) : 0,
          autoplay: false,
        }).finally(() => {
          restoringRef.current = false;
        });
      }
    } catch {
      localStorage.removeItem(RESUME_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sauvegarde la position courante pour la reprise après rechargement (cf. effet ci-dessus).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoringRef.current) return;
    if (state.active && state.queue.length) {
      localStorage.setItem(
        RESUME_KEY,
        JSON.stringify({
          queue: state.queue,
          qIndex: state.queueIndex,
          index: state.index,
          mode: state.mode,
          packVersion: PACK_VERSION,
        }),
      );
    } else {
      localStorage.removeItem(RESUME_KEY);
    }
  }, [state.active, state.queue, state.queueIndex, state.index, state.mode]);

  // Restaure la préférence de suivi auto (persistée).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = localStorage.getItem(AUTONAV_KEY) === "1";
    autoNavRef.current = v;
    if (v) patch({ autoNavigate: true });
  }, [patch]);

  // Miroirs impératifs (lus par les callbacks sans closure périmée).
  useEffect(() => {
    playingRef.current = state.playing;
  }, [state.playing]);
  useEffect(() => {
    modeRef.current = state.mode;
  }, [state.mode]);

  // Nettoyage au démontage.
  useEffect(() => () => player.halt(), [player]);

  // La réserve d'espace en bas (pour que la barre fixe ne masque pas le contenu) est gérée
  // par PodcastPlayer, qui mesure la hauteur réelle de la barre et la publie en `--player-h`.

  // Position piste pour la MediaSession, en UNITÉS-SEGMENTS (1 segment = 1 unité, comme le
  // scrub de seekFraction) : les durées réelles des segments ne sont connues qu'au fil de
  // la synthèse. La barre de l'écran verrouillé est donc fluide et le seek fonctionne, mais
  // les temps affichés ne sont pas des secondes horaires. `playbackRate` = débit réel du
  // segment courant (unités/s) pour que l'interpolation OS entre deux mises à jour colle.
  pushPosRef.current = () => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (typeof ms.setPositionState !== "function") return;
    const n = state.segments.length;
    if (!state.active || !n) return;
    const pos = player.getPosition();
    // Unités-segments par seconde RÉELLE : le débit du segment, dilaté par la vitesse.
    const unitRate = (pos && pos.duration > 0 ? 1 / pos.duration : 0.25) * rate;
    try {
      ms.setPositionState({
        duration: n,
        position: Math.min(n, state.index + Math.min(Math.max(state.segProgress, 0), 1)),
        playbackRate: unitRate,
      });
    } catch {
      /* valeurs hors spec (durée inconnue) */
    }
  };

  // MediaSession : contrôles média OS / Bluetooth / volant (SPEC §11). Seulement quand le
  // lecteur est ACTIF. next/prev = élément suivant/précédent de la tracklist (même
  // granularité que la barre du lecteur) ; ne PAS déclarer seekbackward/seekforward, qui
  // remplacent next/prev sur certaines UI Android.
  //
  // Les handlers sont enregistrés UNE FOIS par session active et lisent les callbacks du
  // rendu courant via une ref : les réenregistrer à chaque changement de segment passait
  // par un état « handler retiré » qui faisait clignoter les boutons de la notification
  // Android à chaque fin de phrase.
  const msActionsRef = useRef({ toggle, next, prev, seekFraction, close, segCount: 0 });
  msActionsRef.current = { toggle, next, prev, seekFraction, close, segCount: state.segments.length };
  useEffect(() => {
    if (!state.active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => msActionsRef.current.toggle());
    ms.setActionHandler("pause", () => msActionsRef.current.toggle());
    ms.setActionHandler("nexttrack", () => msActionsRef.current.next());
    ms.setActionHandler("previoustrack", () => msActionsRef.current.prev());
    try {
      ms.setActionHandler("seekto", (d) => {
        const n = msActionsRef.current.segCount;
        if (d.seekTime != null && n > 0) msActionsRef.current.seekFraction(d.seekTime / n);
      });
    } catch {
      /* action non supportée */
    }
    try {
      ms.setActionHandler("stop", () => msActionsRef.current.close());
    } catch {
      /* action non supportée */
    }
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack", "seekto", "stop"] as const) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [state.active]);

  // Métadonnées de la notification : seulement quand le titre change (les reposer à
  // chaque segment rafraîchissait aussi la notification inutilement).
  useEffect(() => {
    if (!state.active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const base = import.meta.env.BASE_URL;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.title || "Lecture",
        artist: "Learn Japan",
        // PNG raster requis (le SVG est ignoré par les notifications média Android).
        artwork: [
          { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png" },
          { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png" },
        ],
      });
    } catch {
      /* MediaMetadata indisponible */
    }
  }, [state.active, state.title]);

  // État lecture/pause et position (recalés aussi au fil des segments).
  useEffect(() => {
    if (!state.active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    pushPosRef.current();
  }, [state.active, state.playing, state.index, state.segments.length]);

  const api = useMemo<PodcastApi>(
    () => ({
      ...state,
      startLesson,
      playStory,
      enqueueStory,
      playQueueItem,
      reorderQueue,
      removeFromQueue,
      cycleMode,
      toggleAutoNavigate,
      rate,
      cycleRate,
      seekFraction,
      currentPage,
      toggle,
      next,
      prev,
      jumpTo,
      close,
    }),
    [
      state,
      startLesson,
      playStory,
      enqueueStory,
      playQueueItem,
      reorderQueue,
      removeFromQueue,
      cycleMode,
      toggleAutoNavigate,
      rate,
      cycleRate,
      seekFraction,
      currentPage,
      toggle,
      next,
      prev,
      jumpTo,
      close,
    ],
  );

  return <PodcastContext.Provider value={api}>{children}</PodcastContext.Provider>;
}

export function usePodcastPlayer(): PodcastApi {
  const ctx = useContext(PodcastContext);
  if (!ctx) throw new Error("usePodcastPlayer doit être utilisé dans un <PodcastProvider>");
  return ctx;
}
