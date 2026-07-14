import { useEffect, useState } from "react";
import type { StoryRecord } from "../lib/db";
import { allStories, localDateString, recentSrsDaily, type SrsDailyRecord } from "../lib/db";
import { currentMirrorCandidate, type MirrorCandidate } from "../lib/mirror";
import { listLessons, markUnlockNotified, type Lesson } from "../lib/lessons";
import { sessionStats, type SessionStats } from "../lib/reviewSession";
import { markStationCelebrated, tokaidoStatus, type RouteArrival, type TokaidoStatus } from "../lib/tokaido";
import { formatDaysAgo, formatMinutes } from "../lib/time";
import { LessonList } from "./LessonList";
import { OmikujiCard } from "./OmikujiCard";
import { StationArrival } from "./StationArrival";
import { TokaidoStrip } from "./TokaidoStrip";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { LoadingScreen } from "./kit/LoadingScreen";
import { ProgressBar } from "./kit/ProgressBar";
import { SectionLabel } from "./kit/SectionLabel";
import { useGenJobs } from "./useGenJobs";
import { useSettings } from "./useSettings";

interface Props {
  onOpenStory: (story: StoryRecord) => void;
  onOpenCourse: (lesson: Lesson) => void;
  onStartReview: () => void;
  onStartFlow: () => void;
  onStartMirror: () => void;
  onGoCatalogue: () => void;
  onGoStats: () => void;
  onGoVoyage: () => void;
}

function buildDailyStats(stats: SessionStats, daily: SrsDailyRecord[], dailyGoal: number) {
  const todayStr = localDateString();
  const today = daily.find((d) => d.date === todayStr) ?? { date: todayStr, introduced: 0, reviewed: 0 };
  // Série de jours consécutifs à objectif atteint. Un aujourd'hui encore incomplet ne
  // casse pas la série (la journée n'est pas finie) : on l'ignore et on compte depuis hier.
  let streak = 0;
  const sorted = daily.filter((d) => d.date !== todayStr).sort((a, b) => b.date.localeCompare(a.date));
  for (const d of sorted) {
    if (d.reviewed >= dailyGoal) streak++;
    else break;
  }
  if (today.reviewed >= dailyGoal) streak++;
  return {
    reviewed: today.reviewed,
    goal: dailyGoal,
    streak,
    dueCount: stats.dueCount,
    flowMs: today.flowMs ?? 0,
  };
}

export function Home({ onOpenStory, onOpenCourse, onStartReview, onStartFlow, onStartMirror, onGoCatalogue, onGoStats, onGoVoyage }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [dailyData, setDailyData] = useState<ReturnType<typeof buildDailyStats> | null>(null);
  const [unlockedLesson, setUnlockedLesson] = useState<Lesson | null>(null);
  const [tokaido, setTokaido] = useState<TokaidoStatus | null>(null);
  const [mirror, setMirror] = useState<MirrorCandidate | null>(null);
  const { dataVersion } = useGenJobs();
  const { settings } = useSettings();

  async function refresh() {
    const [ls, stats, daily, stories] = await Promise.all([
      listLessons(),
      sessionStats(),
      recentSrsDaily(30), // 30 jours : ne plafonne pas la série affichée à 7
      allStories(),
    ]);
    setLessons(ls);
    setDailyData(buildDailyStats(stats, daily, settings.dailyGoal));
    setTokaido(await tokaidoStatus(ls));
    setMirror(await currentMirrorCandidate(stories));
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

  if (!lessons) return <LoadingScreen />;

  const inProgress = lessons.filter((l) => l.startedAt && !l.completedAt);
  const next = lessons.find((l) => !l.startedAt && !l.completedAt);
  const todo = [...inProgress, ...(next ? [next] : [])];

  async function closeArrival(arrival: RouteArrival) {
    await markStationCelebrated(arrival.route.level, arrival.station.index);
    setTokaido((t) => (t ? { ...t, newlyArrived: undefined } : t));
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-xl">Aujourd'hui</h2>
      </header>

      {tokaido && <TokaidoStrip pos={tokaido.pos} onOpen={onGoVoyage} />}

      {tokaido?.newlyArrived && (
        <StationArrival
          arrival={tokaido.newlyArrived}
          onClose={() => void closeArrival(tokaido.newlyArrived!)}
        />
      )}

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
          <ProgressBar value={(dailyData.reviewed / dailyData.goal) * 100} />
          {dailyData.flowMs > 0 && (
            <span className="text-xs text-muted">
              {formatMinutes(dailyData.flowMs)} d'étude aujourd'hui
            </span>
          )}
          {dailyData.dueCount > 0 && (() => {
            const goalMet = dailyData.reviewed >= dailyData.goal;
            return (
              <Card accentFlag className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <SectionLabel>{goalMet ? "Renforcement" : "Flux d'étude"}</SectionLabel>
                  <span className="font-serif text-lg text-text">
                    {dailyData.dueCount} élément{dailyData.dueCount > 1 ? "s" : ""}{" "}
                    {goalMet ? "à consolider" : "à réviser"}
                  </span>
                  <span className="text-sm text-muted">
                    Le flux enchaîne tes révisions, puis une lecture ou une leçon adaptée.
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" onClick={onStartFlow}>
                    {goalMet ? "Continuer le flux" : "Démarrer le flux"}
                  </Button>
                  <Button variant="ghost" onClick={onStartReview}>
                    Réviser seulement
                  </Button>
                </div>
              </Card>
            );
          })()}
        </section>
      )}

      <OmikujiCard />

      {mirror && (
        <div className="flex items-center justify-between gap-4 border-b border-hairline pb-3">
          <div className="flex flex-col">
            <SectionLabel>Relecture-miroir</SectionLabel>
            <span className="text-sm text-muted">
              Relis « <span className="text-text">{mirror.title}</span> », écrite{" "}
              {formatDaysAgo(mirror.createdAt)} — mesure le chemin parcouru.
            </span>
          </div>
          <Button className="shrink-0" onClick={onStartMirror}>
            Relire
          </Button>
        </div>
      )}

      {unlockedLesson && (
        <Card accentFlag className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <SectionLabel>Nouvelle leçon débloquée</SectionLabel>
            <span className="font-serif text-lg text-text">{unlockedLesson.title}</span>
            <span className="text-sm text-muted">Leçon précédente maîtrisée — continuez sur votre lancée !</span>
          </div>
          <Button
            variant="primary"
            className="shrink-0 whitespace-nowrap"
            onClick={() => { void dismissUnlock(unlockedLesson); onOpenCourse(unlockedLesson); }}
          >
            Voir la leçon →
          </Button>
        </Card>
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

      <div className="flex flex-wrap gap-6">
        <button
          className="cursor-pointer self-start p-0 font-sans text-sm tracking-wide text-muted transition-colors hover:text-accent"
          onClick={onGoCatalogue}
        >
          Voir tout le parcours →
        </button>
        <button
          className="cursor-pointer self-start p-0 font-sans text-sm tracking-wide text-muted transition-colors hover:text-accent"
          onClick={onGoStats}
        >
          Statistiques →
        </button>
      </div>
    </div>
  );
}
