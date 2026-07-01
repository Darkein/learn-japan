import { useEffect, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { recentSrsDaily, type SrsDailyRecord } from "../lib/db";
import { listLessons, markUnlockNotified, type Lesson } from "../lib/lessons";
import { sessionStats, type SessionStats } from "../lib/warmup";
import { LessonList } from "./LessonList";
import { useGenJobs } from "./useGenJobs";
import { useSettings } from "./useSettings";

interface Props {
  onOpenStory: (story: StoryRecord) => void;
  onOpenCourse: (lesson: Lesson) => void;
  onStartReview: () => void;
  onGoCatalogue: () => void;
}

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildDailyStats(stats: SessionStats, daily7: SrsDailyRecord[], dailyGoal: number) {
  const today = daily7.find((d) => d.date === localDateStr()) ?? { date: localDateStr(), introduced: 0, reviewed: 0 };
  let streak = 0;
  const sorted = [...daily7].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of sorted) {
    if (d.reviewed >= dailyGoal) streak++;
    else break;
  }
  return {
    reviewed: today.reviewed,
    goal: dailyGoal,
    streak,
    dueCount: stats.dueCount,
  };
}

export function Home({ onOpenStory, onOpenCourse, onStartReview, onGoCatalogue }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [dailyData, setDailyData] = useState<ReturnType<typeof buildDailyStats> | null>(null);
  const [unlockedLesson, setUnlockedLesson] = useState<Lesson | null>(null);
  const { dataVersion } = useGenJobs();
  const { settings } = useSettings();

  async function refresh() {
    const [ls, stats, daily7] = await Promise.all([
      listLessons(),
      sessionStats(),
      recentSrsDaily(7),
    ]);
    setLessons(ls);
    setDailyData(buildDailyStats(stats, daily7, settings.dailyGoal));
    const newlyUnlocked = ls.find((l) => l.unlockedNaturally);
    setUnlockedLesson(newlyUnlocked ?? null);
  }

  useEffect(() => {
    void refresh();
  }, [dataVersion]);

  async function dismissUnlock(lesson: Lesson) {
    await markUnlockNotified(lesson.id);
    setUnlockedLesson(null);
    void refresh();
  }

  if (!lessons) return <p className="text-muted">Chargement…</p>;

  const inProgress = lessons.filter((l) => l.startedAt && !l.completedAt);
  const next = lessons.find((l) => !l.startedAt && !l.completedAt);
  const todo = [...inProgress, ...(next ? [next] : [])];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-xl">Aujourd'hui</h2>
      </header>

      {dailyData && (dailyData.reviewed > 0 || dailyData.dueCount > 0) && (
        <section className="flex flex-col gap-3">
          <div className="flex gap-4 text-sm">
            <span className="text-muted">
              Révisions du jour : <strong className="text-text">{dailyData.reviewed}</strong> / {dailyData.goal}
            </span>
            {dailyData.streak > 0 && (
              <span className="text-muted">
                🔥 <strong className="text-text">{dailyData.streak}</strong> jour{dailyData.streak > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="h-1 w-full rounded-full bg-hairline overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, (dailyData.reviewed / dailyData.goal) * 100)}%` }}
            />
          </div>
          {dailyData.dueCount > 0 && (() => {
            const goalMet = dailyData.reviewed >= dailyData.goal;
            return (
              <div className="flex items-center justify-between gap-4 rounded-r-sm border-y border-r border-l-4 border-hairline border-l-accent bg-surface p-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-muted">
                    {goalMet ? "Renforcement" : "Révision"}
                  </span>
                  <span className="font-serif text-lg text-text">
                    {dailyData.dueCount} élément{dailyData.dueCount > 1 ? "s" : ""}{" "}
                    {goalMet ? "à consolider" : "à réviser"}
                  </span>
                  {goalMet && (
                    <span className="text-xs text-muted">En plus de ton objectif du jour atteint ✓</span>
                  )}
                </div>
                <button
                  className="cursor-pointer whitespace-nowrap rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors"
                  onClick={onStartReview}
                >
                  {goalMet ? "Continuer" : "Réviser maintenant"}
                </button>
              </div>
            );
          })()}
        </section>
      )}

      {unlockedLesson && (
        <section className="flex items-start justify-between gap-4 rounded-r-sm border-y border-r border-l-4 border-hairline border-l-accent bg-surface p-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">Nouvelle leçon débloquée</span>
            <span className="font-serif text-lg text-text">{unlockedLesson.title}</span>
            <span className="text-sm text-muted">Leçon précédente maîtrisée — continuez sur votre lancée !</span>
          </div>
          <button
            className="cursor-pointer shrink-0 whitespace-nowrap rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors"
            onClick={() => { void dismissUnlock(unlockedLesson); onOpenCourse(unlockedLesson); }}
          >
            Voir la leçon →
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
