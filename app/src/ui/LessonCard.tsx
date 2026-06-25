import { useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { generateLessonIntro, generateLessonStory, type GenState } from "../lib/genClient";
import { grammarDetail, kanjiDetail } from "../lib/inventory";
import {
  getCumulativeObjectives,
  markLessonStarted,
  saveLessonIntro,
  type Lesson,
} from "../lib/lessons";
import { saveStory } from "../lib/stories";
import styles from "./LessonCard.module.css";

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

interface Props {
  lesson: Lesson;
  /** Ouvre une histoire de leçon dans la page de lecture. */
  onOpenStory: (story: StoryRecord) => void;
  /** Notifie le parent qu'une histoire/état a changé (pour rafraîchir la liste). */
  onChanged: () => void;
}

// Génère (et sauve) une nouvelle histoire pour la leçon, contrainte au lexique déjà vu.
async function addStory(lesson: Lesson, setState: (s: GenState) => void): Promise<StoryRecord> {
  const targetKanji = new Set(lesson.objectives.kanji.map((k) => k.ja));
  const knownKanji = getCumulativeObjectives(lesson.id)
    .kanji.map((k) => k.ja)
    .filter((k) => !targetKanji.has(k));
  const text = await generateLessonStory(
    {
      title: lesson.title,
      level: lesson.level,
      vocab: lesson.objectives.vocab,
      kanji: lesson.objectives.kanji,
      grammar: lesson.objectives.grammar,
      known: { kanji: knownKanji },
    },
    setState,
  );
  if (!text.trim()) throw new Error("Histoire vide reçue.");
  return saveStory(
    text,
    {
      level: lesson.level,
      kanji: lesson.objectives.kanji.length ? lesson.objectives.kanji.map((k) => k.ja) : undefined,
      grammar: lesson.objectives.grammar.length ? lesson.objectives.grammar : undefined,
    },
    lesson.id,
  );
}

export function LessonCard({ lesson, onOpenStory, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = genState === "queued" || genState === "generating";

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  // Première génération : cadrage du cours (si absent) + une première histoire, puis lecture.
  async function start() {
    setError(null);
    setGenState("queued");
    try {
      if (!lesson.framing) {
        const intro = await generateLessonIntro(
          {
            title: lesson.title,
            level: lesson.level,
            vocab: lesson.objectives.vocab,
            kanji: lesson.objectives.kanji,
            grammar: lesson.objectives.grammar,
          },
          setGenState,
        );
        if (intro) await saveLessonIntro(lesson.id, intro);
      }
      const story = await addStory(lesson, setGenState);
      onChanged();
      await read(story);
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  // Re-roll : ajoute une histoire supplémentaire à une leçon déjà prête.
  async function anotherStory() {
    setError(null);
    setGenState("queued");
    try {
      await addStory(lesson, setGenState);
      onChanged();
    } catch (e) {
      setError(String(e));
      setGenState("error");
    }
  }

  const ready = lesson.state === "ready";

  return (
    <li className={styles.card} aria-expanded={open}>
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

      <div className={styles.chips}>
        {lesson.objectives.vocab.slice(0, 5).map((v) => (
          <span key={`v-${v.ja}`} className={`${styles.chip} ${styles.chipVocab}`}>
            <span className={styles.chipJa}>{v.ja}</span>
            {v.yomi && v.yomi !== v.ja && <span className={styles.chipYomi}>{v.yomi}</span>}
            <span className={styles.chipFr}>{v.fr}</span>
          </span>
        ))}
        {lesson.objectives.kanji.map((k) => (
          <span key={`k-${k.ja}`} className={`${styles.chip} ${styles.chipKanji}`}>
            <span className={styles.chipJa}>{k.ja}</span>
            <span className={styles.chipFr}>{k.fr}</span>
          </span>
        ))}
        {lesson.objectives.grammar.slice(0, 2).map((g) => (
          <span key={`g-${g}`} className={`${styles.chip} ${styles.chipGrammar}`}>
            {g}
          </span>
        ))}
      </div>

      <div className={styles.actions}>
        {ready ? (
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void read(lesson.stories[0])}
          >
            {lesson.completedAt ? "Relire" : "Lire"}
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
        <button className={styles.btn} onClick={() => setOpen((v) => !v)}>
          {open ? "Masquer le cours" : "Voir le cours"}
        </button>
        {genState && busy && <span className={styles.meta}>Statut : {STATE_LABEL[genState]}</span>}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {open && (
        <div className={styles.panel}>
          <Cours lesson={lesson} />

          {ready && (
            <>
              <h3 className={styles.panelH3}>Histoires</h3>
              <ul className={styles.objRows}>
                {lesson.stories.map((s) => (
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
          )}
        </div>
      )}
    </li>
  );
}

/** Cours d'une leçon : assemblé depuis l'inventaire (grammaire, kanji, vocab) + cadrage rédigé. */
function Cours({ lesson }: { lesson: Lesson }) {
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  const kanji = lesson.introduces.kanji.map(kanjiDetail).filter((k) => k !== null);
  return (
    <div>
      <h3 className={styles.panelH3}>Le cours</h3>
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
