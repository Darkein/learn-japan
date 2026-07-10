import { useEffect, useState } from "react";
import { listLessons, unlockedNeighbors } from "../lib/lessons";
import { useGenJobs } from "./useGenJobs";

// Leçons adjacentes pour la navigation par swipe / flèches, restreintes aux seules leçons
// débloquées. Le verrou (`locked`) dépend de la progression SRS, calculée de façon
// asynchrone par `listLessons()` ; on recharge donc quand la leçon courante change ou qu'une
// génération aboutit (`dataVersion`).

export function useLessonNeighbors(currentId: string | undefined): {
  prevId?: string;
  nextId?: string;
} {
  const { dataVersion } = useGenJobs();
  const [neighbors, setNeighbors] = useState<{ prevId?: string; nextId?: string }>({});

  useEffect(() => {
    let cancelled = false;
    if (!currentId) {
      setNeighbors({});
      return;
    }
    void listLessons().then((lessons) => {
      if (cancelled) return;
      setNeighbors(unlockedNeighbors(lessons, currentId));
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, dataVersion]);

  return neighbors;
}
