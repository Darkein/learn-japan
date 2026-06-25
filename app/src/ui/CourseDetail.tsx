import { useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { grammarDetail, kanjiDetail } from "../lib/inventory";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { STATE_LABEL, useLessonGen } from "./useLessonGen";
import styles from "./CourseDetail.module.css";

interface Props {
  lesson: Lesson;
  /** Ouvre une histoire de leçon dans la page de lecture. */
  onOpenStory: (story: StoryRecord) => void;
  /** Notifie le parent qu'une histoire/état a changé (pour rafraîchir la liste). */
  onChanged: () => void;
}

/**
 * Détail d'un cours : cadrage + objectifs (grammaire / kanji / vocab) + histoires liées.
 * Rendu soit dans le panneau latéral (split desktop), soit dans une page dédiée (mobile).
 */
export function CourseDetail({ lesson, onOpenStory, onChanged }: Props) {
  // Liste locale des histoires : initialisée depuis la leçon, complétée par le re-roll.
  const [stories, setStories] = useState<StoryRecord[]>(lesson.stories);
  const { genState, busy, error, start, anotherStory } = useLessonGen(lesson, {
    onChanged,
    onOpenStory,
    onStoryAdded: (s) => setStories((prev) => [...prev, s]),
  });

  const ready = lesson.state === "ready";

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  return (
    <div className={styles.detail}>
      <Cours lesson={lesson} />

      {ready ? (
        <>
          <h3 className={styles.h3}>Histoires</h3>
          <ul className={styles.objRows}>
            {stories.map((s) => (
              <li key={s.id} className={styles.storyRow}>
                <span className={styles.storyText}>{s.text}</span>
                <button className={styles.btn} onClick={() => void read(s)}>
                  Lire →
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button className={styles.btn} onClick={() => void anotherStory()} disabled={busy}>
              {busy ? "Génération…" : "Générer une autre histoire"}
            </button>
            {genState && busy && <span className={styles.meta}>Statut : {STATE_LABEL[genState]}</span>}
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? "Génération…" : "Commencer la leçon"}
          </button>
          {genState && busy && <span className={styles.meta}>Statut : {STATE_LABEL[genState]}</span>}
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

/** Cours d'une leçon : assemblé depuis l'inventaire (grammaire, kanji, vocab) + cadrage rédigé. */
function Cours({ lesson }: { lesson: Lesson }) {
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  const kanji = lesson.introduces.kanji.map(kanjiDetail).filter((k) => k !== null);
  return (
    <div>
      <h3 className={styles.h3}>Le cours</h3>
      {lesson.framing && <Markdown text={lesson.framing} />}

      {grammar.length > 0 && (
        <dl className={styles.objList}>
          <dt>Grammaire</dt>
          <dd>
            <ul className={styles.objRows}>
              {grammar.map((g) => (
                <li key={g.id}>
                  <span className={styles.objJa}>{g.name}</span>
                  <span className={styles.objFr}>
                    {g.ruleFr} <em>ex. {g.exampleJa}</em>
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </dl>
      )}

      <dl className={styles.objList}>
        {kanji.length > 0 && (
          <>
            <dt>Kanji</dt>
            <dd>
              <ul className={styles.objRows}>
                {kanji.map((k) => (
                  <li key={k.ja}>
                    <span className={styles.objJa}>{k.ja}</span>
                    <span className={styles.objFr}>
                      {k.fr}
                      {(k.on.length > 0 || k.kun.length > 0) && (
                        <em> — {[...k.kun, ...k.on].slice(0, 4).join("・")}</em>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {lesson.objectives.vocab.length > 0 && (
          <>
            <dt>Vocabulaire</dt>
            <dd>
              <ul className={styles.objRows}>
                {lesson.objectives.vocab.map((v) => (
                  <li key={v.ja}>
                    <span className={styles.objJa}>{v.ja}</span>
                    {v.yomi && v.yomi !== v.ja && <span className={styles.objYomi}>{v.yomi}</span>}
                    <span className={styles.objFr}>{v.fr}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

// Rendu minimaliste : **gras** + paragraphes. Aucune dépendance externe.
function Markdown({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className={styles.md}>
      {paragraphs.map((para, i) => (
        <p key={i}>{inlineBold(para)}</p>
      ))}
    </div>
  );
}

function inlineBold(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<strong key={key++}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
