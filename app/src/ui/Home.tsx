import { useEffect, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { listLessons, type Lesson } from "../lib/lessons";
import { dueCards } from "../lib/warmup";
import { LessonList } from "./LessonList";
import { useGenJobs } from "./useGenJobs";

interface Props {
  onOpenStory: (story: StoryRecord) => void;
  onOpenCourse: (lesson: Lesson) => void;
  onStartReview: () => void;
  onGoCatalogue: () => void;
}

/**
 * Accueil « à faire » : fil conducteur qui se remplit progressivement. Met en avant la
 * révision due (contextuelle), la leçon à continuer et la prochaine leçon à découvrir.
 */
export function Home({ onOpenStory, onOpenCourse, onStartReview, onGoCatalogue }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const { dataVersion } = useGenJobs();

  async function refresh() {
    const [ls, due] = await Promise.all([listLessons(), dueCards()]);
    setLessons(ls);
    setDueCount(due.length);
  }
  // Se recharge au montage et dès qu'une génération aboutit (dataVersion change).
  useEffect(() => {
    void refresh();
  }, [dataVersion]);

  if (!lessons) return <p className="text-muted">Chargement…</p>;

  const done = lessons.filter((l) => l.completedAt).length;
  const inProgress = lessons.filter((l) => l.startedAt && !l.completedAt);
  const next = lessons.find((l) => !l.startedAt && !l.completedAt);
  const todo = [...inProgress, ...(next ? [next] : [])];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="font-serif text-xl">Aujourd'hui</h2>
        <p className="m-0 text-sm text-muted">
          {done}/{lessons.length} leçon{lessons.length > 1 ? "s" : ""} terminée{done > 1 ? "s" : ""}
        </p>
      </header>

      {dueCount > 0 && (
        <section className="flex items-center justify-between gap-4 rounded-r-sm border-y border-r border-l-4 border-hairline border-l-accent bg-surface p-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">Révision</span>
            <span className="font-serif text-lg text-text">
              {dueCount} élément{dueCount > 1 ? "s" : ""} à réviser
            </span>
          </div>
          <button
            className="cursor-pointer whitespace-nowrap rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors"
            onClick={onStartReview}
          >
            Réviser maintenant
          </button>
        </section>
      )}

      {todo.length > 0 ? (
        <LessonList lessons={todo} onOpenStory={onOpenStory} onOpenCourse={onOpenCourse} />
      ) : (
        <p className="text-muted">
          Tout est à jour — bravo ! Explore le{" "}
          <button
            className="cursor-pointer self-start p-0 font-sans text-sm tracking-wide text-muted transition-colors hover:text-accent"
            onClick={onGoCatalogue}
          >
            catalogue
          </button>{" "}
          pour aller plus loin.
        </p>
      )}

      <button
        className="cursor-pointer self-start p-0 font-sans text-sm tracking-wide text-muted transition-colors hover:text-accent"
        onClick={onGoCatalogue}
      >
        Voir tout le parcours →
      </button>
    </div>
  );
}
