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
import { PACK_VERSION, type PodcastSegment } from "../lib/podcastScript";
import { createSegmentPlayer, type SegmentPlayer } from "../lib/segmentPlayer";
import { buildStorySegments } from "../lib/storyPodcast";

const RESUME_KEY = "podcast.resume";

interface PodcastState {
  active: boolean;
  title: string;
  segments: PodcastSegment[];
  index: number;
  /** Avancement (0..1) du segment en cours (temps réel en mode cloud, estimé en mode speech). */
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
}

interface StoryRef {
  storyId: string;
  title: string;
}

interface PodcastApi extends PodcastState {
  startLesson: (lessonId: string) => void;
  playStory: (item: StoryRef) => void;
  enqueueStory: (item: StoryRef) => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  cycleMode: () => void;
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
};

export function PodcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PodcastState>(INITIAL_STATE);

  // État impératif (évite les closures périmées dans les callbacks du moteur audio).
  const restoringRef = useRef(false); // reprise en cours au montage : ne pas écraser RESUME_KEY entre-temps
  const playingRef = useRef(false); // miroir de state.playing pour toggle (sans closure périmée)
  const loadTokenRef = useRef(0); // invalide une pré-génération devenue obsolète (close / relance)
  const queueRef = useRef<QueueItem[]>([]); // miroir de la file
  const qIndexRef = useRef(0); // index de la piste courante dans la file
  const modeRef = useRef<PlayMode>("auto"); // miroir du mode de lecture
  const endedRef = useRef<() => void>(() => undefined); // fin de piste (recalculée à chaque rendu)

  const patch = useCallback((p: Partial<PodcastState>) => setState((s) => ({ ...s, ...p })), []);

  // Moteur de lecture (créé une fois ; ses callbacks ne lisent que des refs et `patch`, stables).
  const playerRef = useRef<SegmentPlayer | null>(null);
  if (!playerRef.current) {
    playerRef.current = createSegmentPlayer({
      onSegmentStart: (i) => patch({ index: i, segProgress: 0, currentTokenIndex: null }),
      onProgress: (p) => patch({ segProgress: p }),
      onToken: (i) => patch({ currentTokenIndex: i }),
      onError: (message) => patch({ error: message, playing: false }),
      onEnded: () => endedRef.current(),
    });
  }
  const player = playerRef.current;

  const startAt = useCallback(
    (i: number) => {
      patch({ playing: true, error: null });
      player.start(i);
    },
    [patch, player],
  );

  // Charge une piste (leçon ou histoire). `resumeIndex`/`autoplay` servent à reprendre une
  // session (après rechargement de page) sur le segment où l'on s'était arrêté.
  const loadItem = useCallback(
    async (item: QueueItem, opts?: { resumeIndex?: number; autoplay?: boolean }) => {
      const autoplay = opts?.autoplay ?? true;
      const startIndex = opts?.resumeIndex ?? 0;
      player.halt();
      const token = ++loadTokenRef.current;
      player.resetMode();
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
      qIndexRef.current = i;
      patch({ queueIndex: i });
      void loadItem(q[i], { autoplay: true });
    },
    [loadItem, patch],
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
    if (last.kind === "lesson") {
      const order = getCurriculum();
      const i = order.findIndex((c) => c.id === last.lessonId);
      const nxt = i >= 0 ? order[i + 1] : undefined;
      return nxt ? { kind: "lesson", lessonId: nxt.id, title: nxt.title } : null;
    }
    const all = await allStories();
    const i = all.findIndex((s) => s.id === last.storyId);
    const nxt = i >= 0 ? all[i + 1] : undefined;
    return nxt ? { kind: "story", storyId: nxt.id, title: nxt.titleFr ?? nxt.title } : null;
  }

  async function handleEnded(): Promise<void> {
    const q = queueRef.current;
    const idx = qIndexRef.current;
    // Fin terminale (rien à enchaîner) : on rembobine la piste courante pour que « Lecture »
    // reparte du début plutôt que de rejouer la dernière phrase.
    const rewind = () => {
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
      void getLesson(lessonId).then((lesson) => {
        const qi: QueueItem = { kind: "lesson", lessonId, title: lesson?.title ?? lessonId };
        setQueue([qi]);
        qIndexRef.current = 0;
        patch({ queueIndex: 0 });
        void loadItem(qi, { autoplay: true });
      });
    },
    [loadItem, patch, setQueue],
  );

  const playStory = useCallback(
    (item: StoryRef) => {
      const qi: QueueItem = { kind: "story", storyId: item.storyId, title: item.title };
      setQueue([qi]);
      qIndexRef.current = 0;
      patch({ queueIndex: 0 });
      void loadItem(qi, { autoplay: true });
    },
    [loadItem, patch, setQueue],
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

  const toggle = useCallback(() => {
    if (!player.hasSegments()) return;
    if (playingRef.current) {
      player.halt();
      patch({ playing: false });
    } else {
      startAt(player.index());
    }
  }, [patch, player, startAt]);

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

  const next = useCallback(() => seek(player.index() + 1), [player, seek]);
  const prev = useCallback(() => seek(player.index() - 1), [player, seek]);
  const jumpTo = useCallback((i: number) => seek(i), [seek]);

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
      };
      if (saved.queue?.length) {
        restoringRef.current = true;
        queueRef.current = saved.queue;
        qIndexRef.current = saved.qIndex ?? 0;
        modeRef.current = saved.mode ?? "auto";
        patch({ queue: saved.queue, queueIndex: qIndexRef.current, mode: saved.mode ?? "auto" });
        void loadItem(saved.queue[qIndexRef.current], {
          resumeIndex: saved.index ?? 0,
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
        JSON.stringify({ queue: state.queue, qIndex: state.queueIndex, index: state.index, mode: state.mode }),
      );
    } else {
      localStorage.removeItem(RESUME_KEY);
    }
  }, [state.active, state.queue, state.queueIndex, state.index, state.mode]);

  // Miroirs impératifs (lus par les callbacks sans closure périmée).
  useEffect(() => {
    playingRef.current = state.playing;
  }, [state.playing]);
  useEffect(() => {
    modeRef.current = state.mode;
  }, [state.mode]);

  // Nettoyage au démontage.
  useEffect(() => () => player.halt(), [player]);

  // Réserve de l'espace en bas pour que la barre fixe ne masque pas le contenu.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.paddingBottom = state.active ? "6.5rem" : "";
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [state.active]);

  // MediaSession : contrôles média OS / Bluetooth / volant (SPEC §11). Seulement quand le
  // lecteur est ACTIF.
  useEffect(() => {
    if (!state.active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: state.title || "Lecture", artist: "Learn Japan" });
    } catch {
      /* MediaMetadata indisponible */
    }
    ms.setActionHandler("play", () => toggle());
    ms.setActionHandler("pause", () => toggle());
    ms.setActionHandler("nexttrack", () => next());
    ms.setActionHandler("previoustrack", () => prev());
    ms.playbackState = state.playing ? "playing" : "paused";
    return () => {
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) {
        try {
          ms.setActionHandler(a, null);
        } catch {
          /* ignore */
        }
      }
    };
  }, [state.active, state.playing, state.title, toggle, next, prev]);

  const api = useMemo<PodcastApi>(
    () => ({
      ...state,
      startLesson,
      playStory,
      enqueueStory,
      reorderQueue,
      removeFromQueue,
      cycleMode,
      toggle,
      next,
      prev,
      jumpTo,
      close,
    }),
    [state, startLesson, playStory, enqueueStory, reorderQueue, removeFromQueue, cycleMode, toggle, next, prev, jumpTo, close],
  );

  return <PodcastContext.Provider value={api}>{children}</PodcastContext.Provider>;
}

export function usePodcastPlayer(): PodcastApi {
  const ctx = useContext(PodcastContext);
  if (!ctx) throw new Error("usePodcastPlayer doit être utilisé dans un <PodcastProvider>");
  return ctx;
}
