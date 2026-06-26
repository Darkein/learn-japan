// Lecteur podcast global et persistant (SPEC §11). Un contexte React porté au niveau de
// l'app : il survit à la navigation entre onglets/pages. Il pré-génère le pack d'une leçon
// (via `generatePodcastPack`), puis joue ses segments en continu — cadrage → quiz (avec un
// blanc de réponse) → histoire (alternance JP/FR) → transition — et enchaîne sur la leçon
// suivante (ou boucle au début). Audio Cloud TTS mis en cache, repli Web Speech.

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
import { getCurriculum, getLesson, markLessonStarted } from "../lib/lessons";
import {
  generatePodcastPack,
  getPodcastPack,
  PACK_VERSION,
  type PodcastSegment,
} from "../lib/podcast";
import { synthesizeText, TtsUnconfiguredError } from "../lib/ttsClient";

interface PodcastState {
  active: boolean;
  title: string;
  segments: PodcastSegment[];
  index: number;
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

const LANG_TAG: Record<PodcastSegment["lang"], string> = { fr: "fr-FR", ja: "ja-JP" };

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: PodcastSegment["lang"]): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const pref = lang === "fr" ? "fr" : "ja";
  return window.speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith(pref)) ?? null;
}

export function PodcastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PodcastState>({
    active: false,
    title: "",
    segments: [],
    index: 0,
    playing: false,
    preparing: null,
    error: null,
  });

  // État impératif (évite les closures périmées dans les callbacks audio/parole).
  const runRef = useRef(0); // jeton d'exécution : invalide les continuations annulées
  const segmentsRef = useRef<PodcastSegment[]>([]);
  const indexRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<"cloud" | "speech">("cloud");
  const chainTargetRef = useRef<string | null>(null); // leçon suivante (ou première = boucle)
  const startLessonRef = useRef<(lessonId: string) => void>(() => undefined);
  const playingRef = useRef(false); // miroir de state.playing pour toggle (sans closure périmée)
  const loadTokenRef = useRef(0); // invalide une pré-génération devenue obsolète (close / relance)

  const patch = useCallback((p: Partial<PodcastState>) => setState((s) => ({ ...s, ...p })), []);

  const cleanupAudio = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const halt = useCallback(() => {
    runRef.current++;
    cleanupAudio();
    if (speechSupported()) window.speechSynthesis.cancel();
  }, [cleanupAudio]);

  // Avance après un segment (en respectant un éventuel blanc de réponse de quiz).
  const playFrom = useRef<(i: number, run: number) => void>(() => undefined);

  const afterSegment = useCallback((i: number, run: number) => {
    if (run !== runRef.current) return;
    const seg = segmentsRef.current[i];
    const go = () => {
      if (run === runRef.current) playFrom.current(i + 1, run);
    };
    if (seg?.pauseAfterMs) {
      timerRef.current = setTimeout(go, seg.pauseAfterMs);
    } else {
      go();
    }
  }, []);

  const speakSegment = useCallback(
    (i: number, run: number) => {
      const seg = segmentsRef.current[i];
      if (!seg) return;
      if (!speechSupported()) {
        afterSegment(i, run); // pas de parole dispo → on enchaîne (au moins les pauses)
        return;
      }
      const u = new SpeechSynthesisUtterance(seg.text);
      u.lang = LANG_TAG[seg.lang];
      const v = pickVoice(seg.lang);
      if (v) u.voice = v;
      u.onend = () => afterSegment(i, run);
      window.speechSynthesis.speak(u);
    },
    [afterSegment],
  );

  const playCloud = useCallback(
    async (i: number, run: number) => {
      const seg = segmentsRef.current[i];
      if (!seg) return;
      let blob: Blob;
      try {
        blob = await synthesizeText(seg.text, seg.lang);
      } catch (e) {
        if (run !== runRef.current) return;
        if (e instanceof TtsUnconfiguredError) {
          modeRef.current = "speech"; // bascule tout le pack sur la Web Speech API
          speakSegment(i, run);
          return;
        }
        patch({ error: String(e instanceof Error ? e.message : e), playing: false });
        return;
      }
      if (run !== runRef.current) return;
      cleanupAudio();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => afterSegment(i, run);
      try {
        await audio.play();
      } catch {
        /* lecture coupée / autoplay bloqué — géré par toggle/close */
      }
    },
    [afterSegment, cleanupAudio, patch, speakSegment],
  );

  // Joue le segment i (fin de pack → enchaînement sur la leçon suivante / boucle).
  playFrom.current = (i: number, run: number) => {
    if (run !== runRef.current) return;
    const segs = segmentsRef.current;
    if (i >= segs.length) {
      const target = chainTargetRef.current;
      if (target) startLessonRef.current(target);
      else patch({ playing: false });
      return;
    }
    indexRef.current = i;
    patch({ index: i });
    if (modeRef.current === "speech") speakSegment(i, run);
    else void playCloud(i, run);
  };

  const startAt = useCallback((i: number) => {
    const run = ++runRef.current;
    patch({ playing: true, error: null });
    playFrom.current(i, run);
  }, [patch]);

  const toggle = useCallback(() => {
    if (!segmentsRef.current.length) return;
    if (playingRef.current) {
      halt();
      patch({ playing: false });
    } else {
      // Reprise : on relit le segment courant depuis son début.
      startAt(indexRef.current);
    }
  }, [halt, patch, startAt]);

  const next = useCallback(() => {
    if (!segmentsRef.current.length) return;
    startAt(Math.min(indexRef.current + 1, segmentsRef.current.length - 1));
  }, [startAt]);

  const prev = useCallback(() => {
    if (!segmentsRef.current.length) return;
    startAt(Math.max(indexRef.current - 1, 0));
  }, [startAt]);

  const jumpTo = useCallback((i: number) => startAt(i), [startAt]);

  const close = useCallback(() => {
    halt();
    loadTokenRef.current++; // annule une éventuelle pré-génération en cours
    chainTargetRef.current = null;
    segmentsRef.current = [];
    indexRef.current = 0;
    setState({ active: false, title: "", segments: [], index: 0, playing: false, preparing: null, error: null });
  }, [halt]);

  const startLesson = useCallback(
    async (lessonId: string) => {
      halt();
      const token = ++loadTokenRef.current; // toute relance/fermeture invalide ce chargement
      modeRef.current = "cloud";
      indexRef.current = 0;
      patch({ active: true, playing: false, error: null, preparing: "Préparation…", index: 0 });
      try {
        const lesson = await getLesson(lessonId);
        if (!lesson) throw new Error(`Leçon introuvable : ${lessonId}`);

        // Leçon suivante (pour l'annonce de transition) ; à défaut, on boucle au début.
        const order = getCurriculum();
        const idx = order.findIndex((c) => c.id === lessonId);
        const nextEntry = idx >= 0 ? order[idx + 1] : undefined;

        // Pack réutilisé seulement s'il est à jour ; sinon régénéré (correctifs de format).
        const existing = await getPodcastPack(lessonId);
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
        segmentsRef.current = pack.segments;
        patch({ title: lesson.title, segments: pack.segments, preparing: null });
        startAt(0);
      } catch (e) {
        if (token === loadTokenRef.current) {
          patch({ preparing: null, playing: false, error: String(e instanceof Error ? e.message : e) });
        }
      }
    },
    [halt, patch, startAt],
  );
  startLessonRef.current = (id) => void startLesson(id);

  // Miroir impératif de l'état de lecture (lu par toggle sans closure périmée).
  useEffect(() => {
    playingRef.current = state.playing;
  }, [state.playing]);

  // Nettoyage au démontage.
  useEffect(() => () => halt(), [halt]);

  // Réserve de l'espace en bas pour que la barre fixe ne masque pas le contenu.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.paddingBottom = state.active ? "6.5rem" : "";
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [state.active]);

  // MediaSession : contrôles média OS / Bluetooth / volant (SPEC §11).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (state.active) {
      try {
        ms.metadata = new MediaMetadata({ title: state.title || "Podcast", artist: "Learn Japan" });
      } catch {
        /* MediaMetadata indisponible */
      }
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
