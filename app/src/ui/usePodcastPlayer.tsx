// Lecteur podcast global et persistant (SPEC §11). Un contexte React porté au niveau de
// l'app : il survit à la navigation entre onglets/pages. Il pré-génère le pack d'une leçon
// (via `generatePodcastPack`), puis le joue en continu via le moteur lib/segmentPlayer.ts —
// cadrage → quiz (avec un blanc de réponse) → histoire (alternance JP/FR) → transition —
// et enchaîne sur la leçon suivante (ou boucle au début).

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
import { getCurriculum } from "../lib/curriculum";
import { getPodcast } from "../lib/db";
import { getLesson, markLessonStarted } from "../lib/lessons";
import { generatePodcastPack } from "../lib/podcast";
import { PACK_VERSION, type PodcastSegment } from "../lib/podcastScript";
import { createSegmentPlayer, type SegmentPlayer } from "../lib/segmentPlayer";

const RESUME_KEY = "podcast.resume";

interface PodcastState {
  active: boolean;
  lessonId: string | null;
  title: string;
  segments: PodcastSegment[];
  index: number;
  /** Avancement (0..1) du segment en cours (temps réel en mode cloud, estimé en mode speech). */
  segProgress: number;
  /** Position de la leçon en cours dans le programme (curriculum), -1 si inconnue. */
  lessonIndex: number;
  lessonTotal: number;
  playing: boolean;
  /** Message de progression pendant la pré-génération (null si prêt). */
  preparing: string | null;
  error: string | null;
}

interface PodcastApi extends PodcastState {
  startLesson: (lessonId: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (index: number) => void;
  close: () => void;
}

const PodcastContext = createContext<PodcastApi | null>(null);

const INITIAL_STATE: PodcastState = {
  active: false,
  lessonId: null,
  title: "",
  segments: [],
  index: 0,
  segProgress: 0,
  lessonIndex: -1,
  lessonTotal: 0,
  playing: false,
  preparing: null,
  error: null,
};

export function PodcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PodcastState>(INITIAL_STATE);

  // État impératif (évite les closures périmées dans les callbacks du moteur audio).
  const chainTargetRef = useRef<string | null>(null); // leçon suivante (ou première = boucle)
  const startLessonRef = useRef<(lessonId: string) => void>(() => undefined);
  const restoringRef = useRef(false); // reprise en cours au montage : ne pas écraser RESUME_KEY entre-temps
  const playingRef = useRef(false); // miroir de state.playing pour toggle (sans closure périmée)
  const loadTokenRef = useRef(0); // invalide une pré-génération devenue obsolète (close / relance)

  const patch = useCallback((p: Partial<PodcastState>) => setState((s) => ({ ...s, ...p })), []);

  // Moteur de lecture (créé une fois ; ses callbacks ne lisent que des refs et `patch`, stables).
  const playerRef = useRef<SegmentPlayer | null>(null);
  if (!playerRef.current) {
    playerRef.current = createSegmentPlayer({
      onSegmentStart: (i) => patch({ index: i, segProgress: 0 }),
      onProgress: (p) => patch({ segProgress: p }),
      onToken: () => {},
      onError: (message) => patch({ error: message, playing: false }),
      onEnded: () => {
        const target = chainTargetRef.current;
        if (target) startLessonRef.current(target);
        else patch({ playing: false });
      },
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

  const toggle = useCallback(() => {
    if (!player.hasSegments()) return;
    if (playingRef.current) {
      player.halt();
      patch({ playing: false });
    } else {
      // Reprise : on relit le segment courant depuis son début.
      startAt(player.index());
    }
  }, [patch, player, startAt]);

  // Change de segment sans relancer la lecture si le lecteur est en pause (seul `toggle` démarre).
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
    loadTokenRef.current++; // annule une éventuelle pré-génération en cours
    chainTargetRef.current = null;
    player.setSegments([]);
    player.setIndex(0);
    // Libère la session média OS : sans ça, Chrome garde le playbackState "playing"/"paused"
    // même après fermeture du lecteur, ce qui maintient le ducking du volume système jusqu'à
    // la fermeture complète du navigateur.
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

  // Charge le pack d'une leçon. `resumeIndex`/`autoplay` servent à reprendre une session
  // (après rechargement de page) sur le segment où l'on s'était arrêté, sans lecture auto
  // (bloquée par le navigateur sans geste utilisateur).
  const loadLesson = useCallback(
    async (lessonId: string, opts?: { resumeIndex?: number; autoplay?: boolean }) => {
      const autoplay = opts?.autoplay ?? true;
      const startIndex = opts?.resumeIndex ?? 0;
      player.halt();
      const token = ++loadTokenRef.current; // toute relance/fermeture invalide ce chargement
      player.resetMode();
      player.setIndex(startIndex);
      patch({
        active: true,
        playing: false,
        error: null,
        preparing: "Préparation…",
        index: startIndex,
        segProgress: 0,
      });
      try {
        const lesson = await getLesson(lessonId);
        if (!lesson) throw new Error(`Leçon introuvable : ${lessonId}`);

        // Leçon suivante (pour l'annonce de transition) ; à défaut, on boucle au début.
        const order = getCurriculum();
        const idx = order.findIndex((c) => c.id === lessonId);
        const nextEntry = idx >= 0 ? order[idx + 1] : undefined;

        // Pack réutilisé seulement s'il est à jour ; sinon régénéré (correctifs de format).
        const existing = await getPodcast(lessonId);
        const pack =
          existing && existing.version === PACK_VERSION
            ? existing
            : await generatePodcastPack(
                lessonId,
                { nextLessonTitle: nextEntry?.title },
                (msg) => {
                  if (token === loadTokenRef.current) patch({ preparing: msg });
                },
              );
        if (token !== loadTokenRef.current) return; // chargement obsolète (fermé/relancé)

        await markLessonStarted(lessonId);
        chainTargetRef.current = nextEntry?.id ?? order[0]?.id ?? null;
        player.setSegments(pack.segments);
        const clampedIndex = Math.min(startIndex, Math.max(0, pack.segments.length - 1));
        player.setIndex(clampedIndex);
        patch({
          lessonId,
          title: lesson.title,
          segments: pack.segments,
          preparing: null,
          index: clampedIndex,
          lessonIndex: idx,
          lessonTotal: order.length,
        });
        if (autoplay) startAt(clampedIndex);
      } catch (e) {
        if (token === loadTokenRef.current) {
          if (typeof window !== "undefined") localStorage.removeItem(RESUME_KEY);
          patch({ preparing: null, playing: false, error: String(e instanceof Error ? e.message : e) });
        }
      }
    },
    [patch, player, startAt],
  );
  startLessonRef.current = (id) => void loadLesson(id, { autoplay: true });

  const startLesson = useCallback((lessonId: string) => void loadLesson(lessonId, { autoplay: true }), [loadLesson]);

  // Reprise après rechargement de page : si un lecteur était ouvert, on réouvre la même
  // leçon au même segment (sans lecture auto, bloquée sans geste utilisateur).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { lessonId?: string; index?: number };
      if (saved.lessonId) {
        restoringRef.current = true;
        void loadLesson(saved.lessonId, { resumeIndex: saved.index ?? 0, autoplay: false }).finally(() => {
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
    if (restoringRef.current) return; // reprise en cours : éviter d'écraser la clé avant qu'elle aboutisse
    if (state.active && state.lessonId) {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ lessonId: state.lessonId, index: state.index }));
    } else {
      localStorage.removeItem(RESUME_KEY);
    }
  }, [state.active, state.lessonId, state.index]);

  // Miroir impératif de l'état de lecture (lu par toggle sans closure périmée).
  useEffect(() => {
    playingRef.current = state.playing;
  }, [state.playing]);

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
  // lecteur podcast est ACTIF : sinon on volerait les contrôles au lecteur d'article
  // (useArticlePlayer), qui enregistre les siens pendant la lecture d'une histoire.
  useEffect(() => {
    if (!state.active) return;
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: state.title || "Podcast", artist: "Learn Japan" });
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
    () => ({ ...state, startLesson: (id) => void startLesson(id), toggle, next, prev, jumpTo, close }),
    [state, startLesson, toggle, next, prev, jumpTo, close],
  );

  return <PodcastContext.Provider value={api}>{children}</PodcastContext.Provider>;
}

export function usePodcastPlayer(): PodcastApi {
  const ctx = useContext(PodcastContext);
  if (!ctx) throw new Error("usePodcastPlayer doit être utilisé dans un <PodcastProvider>");
  return ctx;
}
