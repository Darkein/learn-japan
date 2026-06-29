import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { type GenState } from "../lib/genClient";
import {
  addLessonStory,
  ensureLessonFraming,
  markLessonStarted,
  type Lesson,
} from "../lib/lessons";
import { useNotify } from "./useNotify";

export const STATE_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

interface Options {
  onChanged: () => void;
  onOpenStory: (story: StoryRecord) => void;
  /** Appelé avec l'histoire fraîchement générée (ajout), pour mise à jour locale. */
  onStoryAdded?: (story: StoryRecord) => void;
}

/**
 * Logique de génération d'une leçon, partagée entre la carte résumé (`LessonCard`)
 * et le détail du cours (`CourseDetail`).
 */
export function useLessonGen(lesson: Lesson, { onChanged, onOpenStory, onStoryAdded }: Options) {
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useNotify();

  const busy = genState === "queued" || genState === "generating";

  // Première ouverture : cadrage du cours (si absent) + variante 1 (cache hit si pré-générée).
  async function start() {
    setError(null);
    setGenState("queued");
    try {
      await ensureLessonFraming(lesson, setGenState);
      const story = await addLessonStory(lesson, 1, setGenState);
      onChanged();
      if (story.lessonId) await markLessonStarted(story.lessonId);
      notify({
        message: `Leçon « ${lesson.title} » prête.`,
        action: { label: "Lire →", onClick: () => onOpenStory(story) },
      });
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  // Ajoute la variante suivante (ou une variante distante spécifique).
  async function addStory(variant?: number) {
    setError(null);
    setGenState("queued");
    try {
      const story = await addLessonStory(lesson, variant, setGenState);
      onStoryAdded?.(story);
      onChanged();
      notify({
        message: "Nouvelle histoire prête.",
        action: { label: "Lire →", onClick: () => onOpenStory(story) },
      });
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  return { genState, busy, error, start, addStory };
}
