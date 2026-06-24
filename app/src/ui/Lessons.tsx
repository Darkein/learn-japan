import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { generateLessonIntro, generateLessonStory, type GenState } from "../lib/genClient";
import { grammarDetail, kanjiDetail } from "../lib/inventory";
import {
  getCumulativeObjectives,
  listLessons,
  markLessonStarted,
  saveLessonIntro,
  type Lesson,
} from "../lib/lessons";
import { saveStory } from "../lib/stories";
import styles from "./Lessons.module.css";

interface Props {
  /** Ouvre une histoire de leçon dans le lecteur (chemin unifié avec l'onglet Histoires). */
  onOpenStory: (story: StoryRecord) => void;
}

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file…",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "inconnu",
};

export function Lessons({ onOpenStory }: Props) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [genStates, setGenStates] = useState<Record<string, GenState>>({});
  const [genErrors, setGenErrors] = useState<Record<string, string>>({});

  async function refresh() {
    setLessons(await listLessons());
  }
  useEffect(() => {
    void refresh();
  }, []);

  const totals = useMemo(() => {
    if (!lessons) return { ready: 0, done: 0, total: 0 };
    return {
      ready: lessons.filter((l) => l.state === "ready").length,
      done: lessons.filter((l) => l.completedAt).length,
      total: lessons.length,
    };
  }, [lessons]);

  // Génère (et sauve) une nouvelle histoire pour la leçon, contrainte au lexique déjà vu.
  async function addStory(lesson: Lesson, setState: (s: GenState) => void) {
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
    await saveStory(
      text,
      {
        level: lesson.level,
        kanji: lesson.objectives.kanji.length ? lesson.objectives.kanji.map((k) => k.ja) : undefined,
        grammar: lesson.objectives.grammar.length ? lesson.objectives.grammar : undefined,
      },
      lesson.id,
    );
  }

  // Première génération : cadrage du cours (si absent) + une première histoire.
  async function generate(lesson: Lesson) {
    setGenErrors((p) => ({ ...p, [lesson.id]: "" }));
    const setState = (s: GenState) => setGenStates((p) => ({ ...p, [lesson.id]: s }));
    setState("queued");
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
          setState,
        );
        if (intro) await saveLessonIntro(lesson.id, intro);
      }
      await addStory(lesson, setState);
      await refresh();
      setOpenId(lesson.id);
    } catch (e) {
      setGenErrors((p) => ({ ...p, [lesson.id]: String(e) }));
      setState("error");
    }
  }

  // Re-roll : ajoute une histoire supplémentaire à une leçon déjà prête.
  async function anotherStory(lesson: Lesson) {
    setGenErrors((p) => ({ ...p, [lesson.id]: "" }));
    const setState = (s: GenState) => setGenStates((p) => ({ ...p, [lesson.id]: s }));
    setState("queued");
    try {
      await addStory(lesson, setState);
      await refresh();
    } catch (e) {
      setGenErrors((p) => ({ ...p, [lesson.id]: String(e) }));
      setState("error");
    }
  }

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  if (!lessons) return <p className={styles.empty}>Chargement…</p>;

  return (
    <div className={styles.wrap}>
      <header className={styles.intro}>
        <h2 className={styles.h2}>Parcours débutant</h2>
        <p className={styles.tagline}>
          Une petite leçon par jour. Chaque leçon t'explique quelques mots et une règle, puis te
          fait lire une courte histoire qui les met en scène.
        </p>
        <p className={styles.progress}>
          {totals.done}/{totals.total} leçon{totals.total > 1 ? "s" : ""} terminée
          {totals.done > 1 ? "s" : ""} · {totals.ready} prête{totals.ready > 1 ? "s" : ""} à lire
        </p>
      </header>

      <ol className={styles.list}>
        {lessons.map((lesson) => {
          const open = openId === lesson.id;
          const gs = genStates[lesson.id];
          const err = genErrors[lesson.id];
          const busy = gs === "queued" || gs === "generating";
          return (
            <li key={lesson.id} className={styles.card} aria-expanded={open}>
              <div className={styles.cardHead}>
                <span className={styles.order}>{lesson.order.toString().padStart(2, "0")}</span>
                <span className={styles.title}>{lesson.title}</span>
                <span className={styles.level}>N{lesson.level}</span>
                <span
                  className={`${styles.badge} ${
                    lesson.completedAt
                      ? styles.badgeDone
                      : lesson.state === "ready"
                        ? styles.badgeReady
                        : styles.badgeTodo
                  }`}
                >
                  {lesson.completedAt
                    ? "terminée"
                    : lesson.state === "ready"
                      ? "prête"
                      : "à générer"}
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
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => setOpenId(open ? null : lesson.id)}
                >
                  {open ? "Replier" : "Ouvrir la leçon"}
                </button>
                {lesson.state === "ready" ? (
                  <button className={styles.btn} onClick={() => void read(lesson.stories[0])}>
                    Lire directement
                  </button>
                ) : (
                  <button
                    className={styles.btn}
                    onClick={() => void generate(lesson)}
                    disabled={busy}
                  >
                    {busy ? "Génération…" : "Générer cette leçon"}
                  </button>
                )}
                {gs && busy && <span className={styles.meta}>Statut : {STATE_LABEL[gs]}</span>}
              </div>

              {err && <p className={styles.error}>{err}</p>}

              {open && (
                <div className={styles.panel}>
                  <Cours lesson={lesson} />

                  <h3 className={styles.panelH3}>Histoires</h3>
                  {lesson.stories.length > 0 ? (
                    <ul className={styles.objRows}>
                      {lesson.stories.map((s) => (
                        <li key={s.id}>
                          <span className={styles.objJa}>{s.text}</span>
                          <button className={styles.btn} onClick={() => void read(s)}>
                            Lire →
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.summary}>
                      Aucune histoire encore. Génère-en une pour commencer à lire.
                    </p>
                  )}

                  <div className={styles.actions}>
                    {lesson.state === "to-generate" ? (
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => void generate(lesson)}
                        disabled={busy}
                      >
                        {busy ? "Génération…" : "Générer cette leçon"}
                      </button>
                    ) : (
                      <button
                        className={styles.btn}
                        onClick={() => void anotherStory(lesson)}
                        disabled={busy}
                      >
                        {busy ? "Génération…" : "Générer une autre histoire"}
                      </button>
                    )}
                    {gs && busy && <span className={styles.meta}>Statut : {STATE_LABEL[gs]}</span>}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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
