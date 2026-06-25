import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import type { Lesson } from "../lib/lessons";
import { CourseDetail } from "./CourseDetail";
import { LessonCard } from "./LessonCard";
import { useMediaQuery } from "./useMediaQuery";
import styles from "./LessonList.module.css";

interface Props {
  lessons: Lesson[];
  onOpenStory: (story: StoryRecord) => void;
  /** Ouvre le cours en page dédiée (utilisé hors mode split). */
  onOpenCourse: (lesson: Lesson) => void;
  onChanged: () => void;
  /** Active la vue splittée (liste + cours) sur les écrans larges. */
  split?: boolean;
}

/**
 * Liste de leçons partagée (Apprendre / Catalogue). Sur écran large avec `split`,
 * affiche une vue à deux colonnes (liste + détail du cours) ; sinon une simple liste
 * dont les cartes ouvrent le cours en page dédiée (cf. `App` → `ReaderPage`).
 */
export function LessonList({ lessons, onOpenStory, onOpenCourse, onChanged, split }: Props) {
  const wide = useMediaQuery("(min-width: 60rem)");
  const effectiveSplit = !!split && wide;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    lessons.find((l) => l.id === selectedId) ?? (effectiveSplit ? lessons[0] : undefined);

  if (!effectiveSplit) {
    return (
      <ol className={styles.list}>
        {lessons.map((lesson) => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            onOpenStory={onOpenStory}
            onOpen={onOpenCourse}
            onChanged={onChanged}
          />
        ))}
      </ol>
    );
  }

  return (
    <div className={styles.split}>
      <ol className={styles.list}>
        {lessons.map((lesson) => (
          <LessonCard
            key={lesson.id}
            lesson={lesson}
            onOpenStory={onOpenStory}
            onOpen={(l) => setSelectedId(l.id)}
            selected={selected?.id === lesson.id}
            onChanged={onChanged}
          />
        ))}
      </ol>
      <div className={styles.pane}>
        {selected ? (
          <CourseDetail
            key={selected.id}
            lesson={selected}
            onOpenStory={onOpenStory}
            onChanged={onChanged}
          />
        ) : (
          <p className={styles.placeholder}>Sélectionne une leçon pour voir le cours.</p>
        )}
      </div>
    </div>
  );
}
