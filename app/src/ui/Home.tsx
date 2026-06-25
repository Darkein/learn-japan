import { useEffect, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { listLessons, type Lesson } from "../lib/lessons";
import { dueCards } from "../lib/warmup";
import { LessonCard } from "./LessonCard";
import styles from "./Home.module.css";

interface Props {
  onOpenStory: (story: StoryRecord) => void;
  onStartReview: () => void;
  onGoCatalogue: () => void;
}

/**
 * Accueil « à faire » : fil conducteur qui se remplit progressivement. Met en avant la
 * révision due (contextuelle), la leçon à continuer et la prochaine leçon à découvrir.
 */
export function Home({ onOpenStory, onStartReview, onGoCatalogue }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [dueCount, setDueCount] = useState(0);

  async function refresh() {
    const [ls, due] = await Promise.all([listLessons(), dueCards()]);
    setLessons(ls);
    setDueCount(due.length);
  }
  useEffect(() => {
    void refresh();
  }, []);

  if (!lessons) return <p className={styles.empty}>Chargement…</p>;

  const done = lessons.filter((l) => l.completedAt).length;
  const inProgress = lessons.filter((l) => l.startedAt && !l.completedAt);
  const next = lessons.find((l) => !l.startedAt && !l.completedAt);
  const todo = [...inProgress, ...(next ? [next] : [])];

  return (
    <div className={styles.wrap}>
      <header className={styles.intro}>
        <h2 className={styles.h2}>Aujourd'hui</h2>
        <p className={styles.progress}>
          {done}/{lessons.length} leçon{lessons.length > 1 ? "s" : ""} terminée{done > 1 ? "s" : ""}
        </p>
      </header>

      {dueCount > 0 && (
        <section className={styles.review}>
          <div className={styles.reviewText}>
            <span className={styles.reviewKicker}>Révision</span>
            <span className={styles.reviewCount}>
              {dueCount} élément{dueCount > 1 ? "s" : ""} à réviser
            </span>
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onStartReview}>
            Réviser maintenant
          </button>
        </section>
      )}

      {todo.length > 0 ? (
        <ol className={styles.list}>
          {todo.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onOpenStory={onOpenStory}
              onChanged={() => void refresh()}
            />
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>
          Tout est à jour — bravo ! Explore le <button className={styles.link} onClick={onGoCatalogue}>catalogue</button> pour aller plus loin.
        </p>
      )}

      <button className={styles.link} onClick={onGoCatalogue}>
        Voir tout le parcours →
      </button>
    </div>
  );
}
