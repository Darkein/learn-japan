import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { generateLessonIntro, generateLessonStory, type GenState } from "../lib/genClient";
import {
  getCumulativeObjectives,
  markLessonStarted,
  saveLessonIntro,
  type Lesson,
} from "../lib/lessons";
import { saveStory } from "../lib/stories";

export const STATE_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

// Génère (et sauve) une nouvelle histoire pour la leçon, contrainte au lexique déjà vu.
async function addStory(lesson: Lesson, setState: (s: GenState) => void): Promise<StoryRecord> {
  const targetKanji = new Set(lesson.objectives.kanji.map((k) => k.ja));
  const knownKanji = getCumulativeObjectives(lesson.id)
    .kanji.map((k) => k.ja)
    .filter((k) => !targetKanji.has(k));
  const text = await generateLessonStory(
    {
      title: lesson.title,
      level: lesson.level,
      vocab: lesson.objectives.vocab,
      kanji: lesson.objectives.kanji,
      grammar: lesson.objectives.grammar,
      known: { kanji: knownKanji },
    },
    setState,
  );
  if (!text.trim()) throw new Error("Histoire vide reçue.");
  return saveStory(
    text,
    {
      level: lesson.level,
      kanji: lesson.objectives.kanji.length ? lesson.objectives.kanji.map((k) => k.ja) : undefined,
      grammar: lesson.objectives.grammar.length ? lesson.objectives.grammar : undefined,
    },
    lesson.id,
  );
}

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
      if (!lesson.framing) {
        const intro = await generateLessonIntro(
          {
            title: lesson.title,
            level: lesson.level,
            vocab: lesson.objectives.vocab,
            kanji: lesson.objectives.kanji,
            grammar: lesson.objectives.grammar,
          },
          setGenState,
        );
        if (intro) await saveLessonIntro(lesson.id, intro);
      }
      const story = await addStory(lesson, setGenState);
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
      const story = await addStory(lesson, setGenState);
      onStoryAdded?.(story);
      onChanged();
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  return { genState, busy, error, start, anotherStory };
}
