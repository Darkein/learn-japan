import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { type GenState } from "../lib/genClient";
import {
  addLessonStory,
  ensureLessonFraming,
  markLessonStarted,
  type Lesson,
} from "../lib/lessons";

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
  /** Appelé avec l'histoire fraîchement générée (re-roll), pour mise à jour locale. */
  onStoryAdded?: (story: StoryRecord) => void;
}

/**
 * Logique de génération d'une leçon, partagée entre la carte résumé (`LessonCard`)
 * et le détail du cours (`CourseDetail`).
 */
export function useLessonGen(lesson: Lesson, { onChanged, onOpenStory, onStoryAdded }: Options) {
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = genState === "queued" || genState === "generating";

  // Première génération : cadrage du cours (si absent) + une première histoire, puis lecture.
  async function start() {
    setError(null);
    setGenState("queued");
    try {
      await ensureLessonFraming(lesson, setGenState);
      const story = await addLessonStory(lesson, setGenState);
      onChanged();
      if (story.lessonId) await markLessonStarted(story.lessonId);
      onOpenStory(story);
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  // Re-roll : ajoute une histoire supplémentaire à une leçon déjà prête.
  async function anotherStory() {
    setError(null);
    setGenState("queued");
    try {
      const story = await addLessonStory(lesson, setGenState);
      onStoryAdded?.(story);
      onChanged();
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  return { genState, busy, error, start, anotherStory };
}
