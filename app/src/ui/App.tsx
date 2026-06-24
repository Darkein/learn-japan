import { useState } from "react";
import type { StoryRecord } from "../lib/db";
import { ReaderPoc, type IncomingStory } from "./ReaderPoc";
import { Stories } from "./Stories";
import { Warmup } from "./Warmup";
import { useTheme, type Theme } from "./useTheme";
import styles from "./App.module.css";

type Tab = "review" | "reader" | "stories" | "catalogue" | "about";

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("reader");
  const [theme, setTheme] = useTheme();
  const [incoming, setIncoming] = useState<IncomingStory | null>(null);

  function openStory(story: StoryRecord) {
    setIncoming({ text: story.text, params: story.params, nonce: Date.now() });
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

      {tab === "review" && <Warmup />}

      {tab === "reader" && <ReaderPoc incoming={incoming} />}

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
