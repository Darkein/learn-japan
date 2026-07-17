import { useEffect, useState } from "react";
import { allArticles, allStories, getStory } from "../lib/db";
import { useGenJobs } from "./useGenJobs";

// Histoires adjacentes dans l'ordre de l'onglet d'origine (du plus récent au plus ancien)
// pour la navigation par swipe / flèches. Le voisinage reste DANS la même collection : un
// article importé glisse vers les articles voisins, une histoire vers les histoires.
// Recharge quand l'histoire courante change ou quand une génération aboutit (`dataVersion`).

export function useStoryNeighbors(currentId: string | undefined): {
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
    void getStory(currentId)
      .then((current) =>
        current?.source?.kind === "article" ? allArticles() : allStories(),
      )
      .then((stories) => {
      if (cancelled) return;
      const i = stories.findIndex((s) => s.id === currentId);
      if (i === -1) {
        setNeighbors({});
        return;
      }
      setNeighbors({
        prevId: i > 0 ? stories[i - 1].id : undefined,
        nextId: i < stories.length - 1 ? stories[i + 1].id : undefined,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [currentId, dataVersion]);

  return neighbors;
}
