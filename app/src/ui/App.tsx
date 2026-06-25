import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { getCurriculumEntry, type Lesson } from "../lib/lessons";
import { Catalogue } from "./Catalogue";
import { CourseDetail } from "./CourseDetail";
import { Histoires } from "./Histoires";
import { Home } from "./Home";
import { ReaderPage } from "./ReaderPage";
import { ReaderPoc, type IncomingStory } from "./ReaderPoc";
import { Warmup } from "./Warmup";
import { useTheme, type Theme } from "./useTheme";

const SHELL = "mx-auto min-h-full max-w-[44rem] px-4 pt-6 pb-16";

type Tab = "home" | "stories" | "catalogue";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "Apprendre" },
  { id: "stories", label: "Histoires" },
  { id: "catalogue", label: "Catalogue" },
];

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [theme, setTheme] = useTheme();
  const [reader, setReader] = useState<IncomingStory | null>(null);
  const [reviewing, setReviewing] = useState(false);
  // Cours ouvert en page dédiée (mobile / écran étroit ; le split desktop est géré dans LessonList).
  const [course, setCourse] = useState<Lesson | null>(null);
  // Force le rafraîchissement des données de l'onglet courant au retour d'une page de lecture.
  const [refreshKey, setRefreshKey] = useState(0);

  // Chemin d'ouverture unique (Apprendre, Histoires, Catalogue). Si l'histoire est rattachée
  // à une leçon, on enrichit le contexte (titre, objectifs) depuis le curriculum.
  function openStory(story: StoryRecord) {
    const entry = story.lessonId ? getCurriculumEntry(story.lessonId) : undefined;
    setReader({
      text: story.text,
      params: story.params,
      nonce: Date.now(),
      lessonContext: entry
        ? {
            lessonId: entry.id,
            title: entry.title,
            level: entry.level,
            objectives: entry.objectives,
          }
        : story.lessonId
          ? { lessonId: story.lessonId }
          : undefined,
    });
  }

  function back() {
    setReader(null);
    setReviewing(false);
    setCourse(null);
    setRefreshKey((n) => n + 1);
  }

  // Pages dédiées : remplacent le shell à onglets (navigation simple, page lisible).
  if (reader) {
    return (
      <div className={SHELL}>
        <ReaderPage title={reader.lessonContext?.title ?? "Lecture"} onBack={back}>
          <ReaderPoc incoming={reader} onComplete={back} />
        </ReaderPage>
      </div>
    );
  }
  if (reviewing) {
    return (
      <div className={SHELL}>
        <ReaderPage title="Révision" onBack={back}>
          <Warmup />
        </ReaderPage>
      </div>
    );
  }
  if (course) {
    return (
      <div className={SHELL}>
        <ReaderPage title={course.title} onBack={back}>
          <CourseDetail lesson={course} onOpenStory={openStory} onChanged={() => undefined} />
        </ReaderPage>
      </div>
    );
  }

  return (
    <div className={`${SHELL} ${tab === "catalogue" ? "min-[60rem]:max-w-[min(76rem,94vw)]" : ""}`}>
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline pb-4">
        <h1 className="font-serif text-xl">
          Learn Japan<span className="ml-2 text-lg text-accent">日本語</span>
        </h1>
        <div
          className="inline-flex overflow-hidden rounded-sm border border-hairline"
          role="group"
          aria-label="Thème"
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="cursor-pointer px-3 py-1 text-xs tracking-wide text-muted aria-pressed:bg-surface-2 aria-pressed:text-text"
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <nav className="mt-6 mb-8 flex gap-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="cursor-pointer border-b-2 border-transparent py-1 font-sans text-sm tracking-wide text-muted aria-[current=true]:border-accent aria-[current=true]:text-text"
            aria-current={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div key={refreshKey}>
        {tab === "home" && (
          <Home
            onOpenStory={openStory}
            onOpenCourse={setCourse}
            onStartReview={() => setReviewing(true)}
            onGoCatalogue={() => setTab("catalogue")}
          />
        )}
        {tab === "stories" && <Histoires onOpen={openStory} />}
        {tab === "catalogue" && <Catalogue onOpenStory={openStory} onOpenCourse={setCourse} />}
      </div>

      <footer className="mt-16 border-t border-hairline pt-4 text-xs leading-relaxed text-muted">
        Lecteur de japonais extensif et adaptatif, local-first et hors-ligne — furigana et gloss
        déterministes (kuromoji), révision espacée FSRS.
      </footer>
    </div>
  );
}
