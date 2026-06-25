import type { StoryRecord } from "../lib/db";
import type { Lesson } from "../lib/lessons";
import { STATE_LABEL, useLessonGen } from "./useLessonGen";
import styles from "./LessonCard.module.css";

interface Props {
  lesson: Lesson;
  /** Ouvre une histoire de leçon dans la page de lecture. */
  onOpenStory: (story: StoryRecord) => void;
  /** Ouvre le cours (panneau latéral en split, page dédiée sinon). */
  onOpen: (lesson: Lesson) => void;
  /** Sélectionne la carte sans la déclencher (mode split). */
  selected?: boolean;
  /** Notifie le parent qu'une histoire/état a changé (pour rafraîchir la liste). */
  onChanged: () => void;
}

// Résumé compact des objectifs, ex. « 5 mots · 2 kanji · 1 point de grammaire ».
function summarize(lesson: Lesson): string {
  const parts: string[] = [];
  const v = lesson.objectives.vocab.length;
  const k = lesson.objectives.kanji.length;
  const g = lesson.objectives.grammar.length;
  if (v) parts.push(`${v} mot${v > 1 ? "s" : ""}`);
  if (k) parts.push(`${k} kanji`);
  if (g) parts.push(`${g} point${g > 1 ? "s" : ""} de grammaire`);
  return parts.join(" · ");
}

export function LessonCard({ lesson, onOpenStory, onOpen, selected, onChanged }: Props) {
  const { genState, busy, error, start } = useLessonGen(lesson, { onChanged, onOpenStory });

  const ready = lesson.state === "ready";
  const summary = summarize(lesson);

  return (
    <li
      className={`${styles.card} ${selected ? styles.cardSelected : ""}`}
      aria-selected={selected}
    >
      <button className={styles.cardOpen} onClick={() => onOpen(lesson)}>
        <div className={styles.cardHead}>
          <span className={styles.order}>{lesson.order.toString().padStart(2, "0")}</span>
          <span className={styles.title}>{lesson.title}</span>
          <span className={styles.level}>N{lesson.level}</span>
          <span
            className={`${styles.badge} ${
              lesson.completedAt
                ? styles.badgeDone
                : ready
                  ? styles.badgeReady
                  : styles.badgeTodo
            }`}
          >
            {lesson.completedAt ? "terminée" : ready ? "prête" : "à générer"}
          </span>
        </div>

        {lesson.summary && <p className={styles.summary}>{lesson.summary}</p>}
        {summary && <p className={styles.objSummary}>{summary}</p>}
      </button>

      <div className={styles.actions}>
        {ready ? (
          <button className={styles.btn} onClick={() => onOpen(lesson)}>
            Voir le cours →
          </button>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? "Génération…" : "Commencer la leçon"}
          </button>
        )}
        {genState && busy && <span className={styles.meta}>Statut : {STATE_LABEL[genState]}</span>}
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </li>
  );
}
