import { useEffect, useRef, useState } from "react";
import { getStory, type StoryRecord } from "../lib/db";
import { enrollStory } from "../lib/enroll";
import { getCurriculumEntry } from "../lib/curriculum";
import { getLesson, type Lesson } from "../lib/lessons";
import { BottomNav, BOTTOM_NAV_HEIGHT } from "./BottomNav";
import { Button } from "./kit/Button";
import { IconGear } from "./kit/Icon";
import { Catalogue } from "./Catalogue";
import { CourseDetail } from "./CourseDetail";
import { Stories } from "./Stories";
import { Home } from "./Home";
import { PodcastPlayer } from "./PodcastPlayer";
import { PodcastProvider, usePodcastPlayer } from "./usePodcastPlayer";
import { ReaderPage } from "./ReaderPage";
import { Reader, type IncomingStory } from "./Reader";
import { useMediaQuery } from "./useMediaQuery";
import { GenJobsProvider, useGenJobs } from "./useGenJobs";
import { NotificationBanner, NotificationProvider } from "./useNotify";
import {
  currentLocation,
  navigate,
  tabForRoute,
  useHashRoute,
  type Tab,
} from "./useHashRoute";
import { Settings } from "./Settings";
import { SettingsPanel } from "./SettingsPanel";
import { ReviewSession } from "./ReviewSession";
import { SettingsProvider, useSettings } from "./useSettings";

const SHELL = "mx-auto min-h-full max-w-[44rem] px-4 pt-6";
// Hauteur approximative du lecteur podcast replié (hors safe-area) — réserve de la place
// dans le shell pour éviter qu'il ne recouvre le contenu (le détail exact varie peu en
// pratique ; la tracklist dépliée peut dépasser cette estimation, cas rare accepté).
const PLAYER_HEIGHT = "8rem";

/** Calcule le padding bas du shell selon ce qui flotte par-dessus (nav du bas, lecteur). */
function shellPadding(navVisible: boolean, playerActive: boolean): string {
  const parts = [
    navVisible ? BOTTOM_NAV_HEIGHT : null,
    playerActive ? PLAYER_HEIGHT : null,
    "var(--safe-b)",
    "1.5rem",
  ].filter(Boolean);
  return `calc(${parts.join(" + ")})`;
}

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: "home", label: "Apprendre", path: "/" },
  { id: "stories", label: "Histoires", path: "/histoires" },
  { id: "catalogue", label: "Catalogue", path: "/catalogue" },
];


// Construit le contexte de lecture à partir d'une histoire enregistrée. Si l'histoire est
// rattachée à une leçon, on enrichit le contexte (titre, objectifs) depuis le curriculum.
function buildIncoming(story: StoryRecord): IncomingStory {
  const entry = story.lessonId ? getCurriculumEntry(story.lessonId) : undefined;
  return {
    id: story.id,
    title: story.titleFr ?? story.title,
    text: story.text,
    params: story.params,
    nonce: Date.now(),
    lessonContext: entry
      ? {
          lessonId: entry.id,
          title: entry.title,
          level: entry.level,
          objectives: entry.objectives,
          grammarIds: entry.introduces.grammar,
        }
      : story.lessonId
        ? { lessonId: story.lessonId }
        : undefined,
  };
}

export function App() {
  // Le lecteur podcast est porté ici (au-dessus du routage) pour persister entre les
  // onglets et les pages, et la barre est rendue par-dessus tout le contenu.
  return (
    <SettingsProvider>
      <NotificationProvider>
        <GenJobsProvider>
          <PodcastProvider>
            <AppShell />
            <PodcastPlayer />
          </PodcastProvider>
        </GenJobsProvider>
        <NotificationBanner />
      </NotificationProvider>
      <SettingsPanel />
    </SettingsProvider>
  );
}

function AppShell() {
  const route = useHashRoute();
  const { openPanel } = useSettings();
  const podcast = usePodcastPlayer();
  // La nav du bas n'a de sens qu'en mobile (pouce) ; sur grand écran on garde des onglets
  // en haut, comme le reste des vues (splits Catalogue/LessonList au même seuil).
  const wide = useMediaQuery("(min-width: 60rem)");
  // Données des sous-pages, résolues depuis l'id contenu dans l'URL (rechargement direct possible).
  const [reader, setReader] = useState<{ id: string; incoming: IncomingStory } | null>(null);
  const [course, setCourse] = useState<Lesson | null>(null);
  // Force le rafraîchissement des données de l'onglet courant au retour d'une page de lecture.
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewOpts, setReviewOpts] = useState<{ lessonId?: string; scope?: "due" | "all" }>({});
  const { dataVersion } = useGenJobs();

  const tab = tabForRoute(route);

  // Quand une génération aboutit (dataVersion), on rafraîchit l'onglet courant et on
  // recharge le cours ouvert (le cours devient lisible, une nouvelle histoire apparaît).
  const courseIdRef = useRef<string | null>(null);
  courseIdRef.current = course?.id ?? null;
  useEffect(() => {
    if (dataVersion === 0) return; // pas de rechargement au montage initial
    setRefreshKey((n) => n + 1);
    const id = courseIdRef.current;
    if (id) getLesson(id).then((l) => l && setCourse(l));
  }, [dataVersion]);

  // Résolution asynchrone des sous-pages : l'URL ne contient qu'un id, on recharge l'objet
  // complet depuis IndexedDB / le curriculum. Couvre le rechargement direct d'une page profonde.
  useEffect(() => {
    let cancelled = false;

    if (route.kind === "reader") {
      if (reader?.id !== route.id) {
        getStory(route.id).then((story) => {
          if (cancelled) return;
          if (story) setReader({ id: story.id, incoming: buildIncoming(story) });
          else navigate("/"); // histoire introuvable (purge) → retour accueil
        });
      }
    } else if (reader) {
      setReader(null);
    }

    if (route.kind === "course") {
      if (course?.id !== route.id) {
        getLesson(route.id).then((lesson) => {
          if (cancelled) return;
          if (lesson) setCourse(lesson);
          else navigate("/");
        });
      }
    } else if (course) {
      setCourse(null);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind, (route as { id?: string }).id]);

  // Ouverture d'une histoire : on enregistre l'origine (`from`) pour un retour fidèle au
  // rechargement, et on pré-remplit l'état pour éviter un flash de chargement.
  function openStory(story: StoryRecord) {
    void enrollStory(story);
    setReader({ id: story.id, incoming: buildIncoming(story) });
    navigate(`/lecture/${encodeURIComponent(story.id)}?from=${encodeURIComponent(currentLocation())}`);
  }

  function openCourse(lesson: Lesson) {
    setCourse(lesson);
    navigate(`/cours/${encodeURIComponent(lesson.id)}?from=${encodeURIComponent(currentLocation())}`);
  }

  function startReview(opts?: { lessonId?: string; scope?: "due" | "all" }) {
    setReviewOpts(opts ?? {});
    navigate(`/revision?from=${encodeURIComponent(currentLocation())}`);
  }

  function back() {
    const from = "from" in route ? route.from : "/";
    setRefreshKey((n) => n + 1);
    navigate(from);
  }

  const subpagePadding = { paddingBottom: shellPadding(false, podcast.active) };

  // Pages dédiées : remplacent le shell à onglets (navigation simple, page lisible).
  if (route.kind === "reader" && reader) {
    return (
      <div className={SHELL} style={subpagePadding}>
        <ReaderPage title={reader.incoming.title ?? "Lecture"} onBack={back}>
          <Reader incoming={reader.incoming} />
        </ReaderPage>
      </div>
    );
  }
  if (route.kind === "review") {
    return (
      <div className={SHELL} style={subpagePadding}>
        <ReaderPage title={reviewOpts.scope === "all" ? "Entraînement" : "Révision"} onBack={back}>
          <ReviewSession opts={reviewOpts} onExit={back} />
        </ReaderPage>
      </div>
    );
  }
  if (route.kind === "course" && course) {
    return (
      <div className={SHELL} style={subpagePadding}>
        <ReaderPage title={course.title} onBack={back}>
          <CourseDetail lesson={course} onOpenStory={openStory} onStartReview={startReview} />
        </ReaderPage>
      </div>
    );
  }
  if (route.kind === "settings") {
    return (
      <div className={SHELL} style={subpagePadding}>
        <ReaderPage title="Paramètres" onBack={back}>
          <Settings />
        </ReaderPage>
      </div>
    );
  }
  // Sous-page demandée mais données pas encore résolues (rechargement direct) : on évite
  // d'afficher brièvement le shell à onglets en attendant getStory/getLesson.
  if (route.kind === "reader" || route.kind === "course") {
    return (
      <div className={SHELL} style={subpagePadding}>
        <ReaderPage title="Chargement…" onBack={back} />
      </div>
    );
  }

  return (
    <div
      className={`${SHELL} ${tab === "catalogue" ? "min-[60rem]:max-w-[min(76rem,94vw)]" : ""}`}
      style={{ paddingBottom: shellPadding(!wide, podcast.active) }}
    >
      <header className="flex items-baseline justify-between gap-4 border-b border-hairline pb-4">
        <h1 className="font-serif text-xl">
          Learn Japan<span className="ml-2 text-lg text-accent">日本語</span>
        </h1>
        <Button size="icon" variant="quiet" onClick={openPanel} aria-label="Paramètres">
          <IconGear />
        </Button>
      </header>

      {wide && (
        <nav className="mt-6 mb-8 flex gap-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="cursor-pointer border-b-2 border-transparent py-1 font-sans text-sm tracking-wide text-muted aria-[current=true]:border-accent aria-[current=true]:text-text"
              aria-current={tab === t.id}
              onClick={() => navigate(t.path)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <div key={refreshKey} className={wide ? "" : "mt-6"}>
        {tab === "home" && (
          <Home
            onOpenStory={openStory}
            onOpenCourse={openCourse}
            onStartReview={startReview}
            onGoCatalogue={() => navigate("/catalogue")}
          />
        )}
        {tab === "stories" && <Stories onOpen={openStory} />}
        {tab === "catalogue" && <Catalogue onOpenStory={openStory} onOpenCourse={openCourse} />}
      </div>

      <footer className="mt-16 border-t border-hairline pt-4 text-sm leading-relaxed text-muted">
        Lecteur de japonais extensif et adaptatif, local-first et hors-ligne — furigana et gloss
        déterministes (kuromoji), révision espacée FSRS.
      </footer>

      {!wide && <BottomNav tabs={TABS} active={tab} onNavigate={navigate} />}
    </div>
  );
}
