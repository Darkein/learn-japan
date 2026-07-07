// Contexte React au-dessus de la file de génération (lib/genJobs.ts). Porté au niveau de
// l'app, il survit à la navigation entre onglets/pages : une génération lancée depuis une
// carte de leçon continue à tourner et reste suivable partout, et est REPRISE au
// rechargement de la page. Expose aussi `dataVersion`, un compteur que les vues de listes
// incrémentent pour se rafraîchir quand un contenu vient d'être généré.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Lesson } from "../lib/lessons";
import {
  addStoryJob,
  configureJobs,
  dismissJob,
  hasRunningJob,
  jobLabel,
  jobProgress,
  jobsSnapshot,
  regenerateFramingJob,
  regenerateStoryJob,
  resumeJobs,
  retryJob,
  startLessonJob,
  subscribeJobs,
  type GenJobPhase,
} from "../lib/genJobs";
import type { StoryRecord } from "../lib/db";
import { currentLocation, navigate } from "./useHashRoute";
import { useNotify } from "./useNotify";

export interface JobView {
  lessonId: string;
  phase: GenJobPhase;
  status: "running" | "error";
  error?: string;
  /** Avancement estimé dans [0, 1]. */
  progress: number;
  label: string;
}

interface GenJobsApi {
  /** Jobs actifs (ou en erreur) indexés par lessonId. */
  jobs: Record<string, JobView>;
  /** Incrémenté à chaque contenu généré → les listes s'y abonnent pour se recharger. */
  dataVersion: number;
  startLesson: (lesson: Lesson) => void;
  addStory: (lesson: Lesson, variant?: number) => void;
  /** Régénère une histoire jugée mauvaise (remplace la même variante par du neuf). */
  regenerateStory: (lesson: Lesson, story: StoryRecord) => void;
  /** Régénère le cours (framing) sans toucher aux histoires. */
  regenerateCourse: (lesson: Lesson) => void;
  retry: (lessonId: string) => void;
  dismiss: (lessonId: string) => void;
}

const GenJobsContext = createContext<GenJobsApi | null>(null);

function openStoryById(id: string): void {
  navigate(`/lecture/${encodeURIComponent(id)}?from=${encodeURIComponent(currentLocation())}`);
}

function openCourseById(id: string): void {
  navigate(`/cours/${encodeURIComponent(id)}?from=${encodeURIComponent(currentLocation())}`);
}

export function GenJobsProvider({ children }: { children: ReactNode }) {
  const { notify } = useNotify();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // `tick` force le recalcul des barres de progression ; `active` cadence le ticker ;
  // `dataVersion` signale aux listes qu'un contenu a changé.
  const [, setTick] = useState(0);
  const [active, setActive] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    configureJobs({
      onDataChange: () => setDataVersion((d) => d + 1),
      onDone: (e) => {
        if (e.fromCache) return;
        // Leçon complète → on ouvre la LEÇON (le cours) ; histoire seule → la lecture.
        notifyRef.current({
          message: e.withFraming ? `Leçon « ${e.title} » prête.` : "Nouvelle histoire prête.",
          action: e.withFraming
            ? { label: "Ouvrir →", onClick: () => openCourseById(e.lessonId) }
            : e.story
              ? { label: "Lire →", onClick: () => openStoryById(e.story!.id) }
              : undefined,
        });
      },
    });
    const unsub = subscribeJobs(() => {
      setTick((t) => t + 1);
      setActive(hasRunningJob());
    });
    void resumeJobs();
    return unsub;
  }, []);

  // Tant qu'un job tourne, on re-rend toutes les 500 ms pour faire avancer l'estimation.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [active]);

  const now = Date.now();
  const jobs: Record<string, JobView> = {};
  for (const job of jobsSnapshot()) {
    jobs[job.lessonId] = {
      lessonId: job.lessonId,
      phase: job.phase,
      status: job.status,
      error: job.error,
      progress: jobProgress(job, now),
      label: jobLabel(job),
    };
  }

  const api: GenJobsApi = {
    jobs,
    dataVersion,
    startLesson: (lesson) => void startLessonJob(lesson),
    addStory: (lesson, variant) => void addStoryJob(lesson, variant),
    regenerateStory: (lesson, story) => void regenerateStoryJob(lesson, story),
    regenerateCourse: (lesson) => void regenerateFramingJob(lesson),
    retry: (lessonId) => void retryJob(lessonId),
    dismiss: (lessonId) => void dismissJob(lessonId),
  };

  return <GenJobsContext.Provider value={api}>{children}</GenJobsContext.Provider>;
}

export function useGenJobs(): GenJobsApi {
  const ctx = useContext(GenJobsContext);
  if (!ctx) throw new Error("useGenJobs doit être utilisé dans un <GenJobsProvider>");
  return ctx;
}
