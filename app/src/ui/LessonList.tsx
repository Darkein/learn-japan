import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import type { Lesson } from "../lib/lessons";
import { CourseDetail } from "./CourseDetail";
import { LessonCard } from "./LessonCard";
import { useMediaQuery } from "./useMediaQuery";

interface Props {
  lessons: Lesson[];
  onOpenStory: (story: StoryRecord) => void;
  /** Ouvre le cours en page dédiée (utilisé hors mode split). */
  onOpenCourse: (lesson: Lesson) => void;
  /** Active la vue splittée (liste + cours) sur les écrans larges. */
  split?: boolean;
}

/**
 * Liste de leçons partagée (Apprendre / Catalogue). Sur écran large avec `split`,
 * affiche une vue à deux colonnes (liste + détail du cours) ; sinon une simple liste
 * dont les cartes ouvrent le cours en page dédiée (cf. `App` → `ReaderPage`).
 */
export function LessonList({ lessons, onOpenStory, onOpenCourse, split }: Props) {
  const wide = useMediaQuery("(min-width: 60rem)");
  const effectiveSplit = !!split && wide;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    lessons.find((l) => l.id === selectedId) ?? (effectiveSplit ? lessons[0] : undefined);

  if (!effectiveSplit) {
    return (
      <ol className="list-none">
        {lessons.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} onOpen={onOpenCourse} />
        ))}
      </ol>
    );
  }

  return (
    <div className="grid grid-cols-3 items-start gap-6">
      <ol className="list-none border-r border-hairline pr-6">
        {lessons.map((lesson) => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            onOpen={(l) => setSelectedId(l.id)}
            selected={selected?.id === lesson.id}
          />
        ))}
      </ol>
      <div className="col-span-2 sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
        {selected ? (
          <CourseDetail key={selected.id} lesson={selected} onOpenStory={onOpenStory} />
        ) : (
          <p className="m-0 text-sm text-muted">Sélectionne une leçon pour voir le cours.</p>
        )}
      </div>
    </div>
  );
}
