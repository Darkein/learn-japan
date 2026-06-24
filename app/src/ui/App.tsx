import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { getCurriculumEntry } from "../lib/lessons";
import { Lessons } from "./Lessons";
import { ReaderPoc, type IncomingStory } from "./ReaderPoc";
import { Stories } from "./Stories";
import { Warmup } from "./Warmup";
import { useTheme, type Theme } from "./useTheme";
import styles from "./App.module.css";

type Tab = "learn" | "review" | "reader" | "stories" | "catalogue" | "about";

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("learn");
  const [theme, setTheme] = useTheme();
  const [incoming, setIncoming] = useState<IncomingStory | null>(null);

  // Chemin d'ouverture unique (onglet Histoires ET leçons). Si l'histoire est rattachée à
  // une leçon, on enrichit le contexte (titre, objectifs) depuis le curriculum.
  function openStory(story: StoryRecord) {
    const entry = story.lessonId ? getCurriculumEntry(story.lessonId) : undefined;
    setIncoming({
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
    setTab("reader");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.brand}>
          Learn Japan<span className={styles.jp}>日本語</span>
        </h1>
        <div className={styles.themeToggle} role="group" aria-label="Thème">
          {THEMES.map((t) => (
            <button
              key={t.id}
              aria-pressed={theme === t.id}
              onClick={() => setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <nav className={styles.nav}>
        <button aria-current={tab === "learn"} onClick={() => setTab("learn")}>
          Apprendre
        </button>
        <button aria-current={tab === "review"} onClick={() => setTab("review")}>
          Réviser
        </button>
        <button aria-current={tab === "reader"} onClick={() => setTab("reader")}>
          Lecteur
        </button>
        <button aria-current={tab === "stories"} onClick={() => setTab("stories")}>
          Histoires
        </button>
        <button aria-current={tab === "catalogue"} onClick={() => setTab("catalogue")}>
          Catalogue
        </button>
        <button aria-current={tab === "about"} onClick={() => setTab("about")}>
          À propos
        </button>
      </nav>

      {tab === "learn" && <Lessons onOpenStory={openStory} />}

      {tab === "review" && <Warmup />}

      {tab === "reader" && (
        <ReaderPoc incoming={incoming} onBackToLessons={() => setTab("learn")} />
      )}

      {tab === "stories" && <Stories onOpen={openStory} />}

      {tab === "catalogue" && (
        <div className={styles.stub}>
          <h2>Catalogue</h2>
          <p>
            Bibliothèque navigable des kanji / vocab / grammaire (statut, JLPT, tags) — arrive en
            Phase 2.
          </p>
        </div>
      )}

      {tab === "about" && (
        <div className={styles.stub}>
          <h2>À propos</h2>
          <p>
            Lecteur de japonais extensif et adaptatif, local-first et hors-ligne. Furigana et gloss
            littéral déterministes (kuromoji), révision espacée FSRS. Voir SPEC.md / ROADMAP.md.
          </p>
        </div>
      )}
    </div>
  );
}
