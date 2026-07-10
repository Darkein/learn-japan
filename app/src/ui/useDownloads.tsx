// Contexte React au-dessus de la file de téléchargement hors-ligne (lib/download.ts).
// Porté au niveau de l'app, il survit à la navigation : un téléchargement lancé depuis une
// carte de leçon reste suivable depuis le détail du cours, et inversement (même registre).
// L'état « déjà téléchargé » (flag meta) est re-vérifié à chaque émission du registre et à
// chaque `dataVersion` (un contenu généré/ajouté peut invalider le flag d'une leçon).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  cancelQueued,
  enqueueDownload,
  getDownloadEntry,
  isLessonDownloaded,
  isStoryDownloaded,
  subscribeDownloads,
} from "../lib/download";
import type { Lesson } from "../lib/lessons";
import { useGenJobs } from "./useGenJobs";

export type DownloadTarget =
  | { kind: "story"; storyId: string }
  | { kind: "lesson"; lesson: Lesson };

export interface DownloadView {
  status: "none" | "queued" | "downloading" | "done" | "error";
  /** Avancement dans [0, 1] (0 hors téléchargement). */
  fraction: number;
  /** Étape en cours (vide hors téléchargement). */
  label: string;
  error?: string;
}

const DownloadsContext = createContext<{ tick: number } | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeDownloads(() => setTick((t) => t + 1)), []);
  return <DownloadsContext.Provider value={{ tick }}>{children}</DownloadsContext.Provider>;
}

/** État + déclencheurs de téléchargement d'une histoire ou d'une leçon. */
export function useDownload(target: DownloadTarget): {
  view: DownloadView;
  start: () => void;
  cancel: () => void;
} {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownload doit être utilisé dans un <DownloadsProvider>");
  const { dataVersion } = useGenJobs();

  const id = target.kind === "story" ? target.storyId : target.lesson.id;
  const lesson = target.kind === "lesson" ? target.lesson : null;
  const [flagged, setFlagged] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = lesson ? isLessonDownloaded(lesson) : isStoryDownloaded(id);
    void check.then((v) => {
      if (alive) setFlagged(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, id, lesson, ctx.tick, dataVersion]);

  const entry = getDownloadEntry(target.kind, id);
  const view: DownloadView = entry
    ? {
        status: entry.status,
        fraction: entry.fraction,
        label: entry.label,
        error: entry.error,
      }
    : { status: flagged ? "done" : "none", fraction: 0, label: "" };

  return {
    view,
    start: () => enqueueDownload(target.kind, id),
    cancel: () => cancelQueued(target.kind, id),
  };
}
