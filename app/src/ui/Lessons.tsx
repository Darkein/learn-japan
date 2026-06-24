import { useEffect, useMemo, useState, type ReactNode } from "react";
import { generateLesson, type GenState } from "../lib/genClient";
import {
  getCumulativeObjectives,
  listLessons,
  markLessonStarted,
  saveGeneratedLesson,
  type Lesson,
} from "../lib/lessons";
import styles from "./Lessons.module.css";

export interface LessonHandoff {
  lessonId: string;
  title: string;
  level: number;
  storyJa: string;
  objectives: Lesson["objectives"];
}

interface Props {
  onOpenStory: (h: LessonHandoff) => void;
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

  async function generate(lesson: Lesson) {
    setGenErrors((p) => ({ ...p, [lesson.id]: "" }));
    const setState = (s: GenState) => setGenStates((p) => ({ ...p, [lesson.id]: s }));
    setState("queued");
    try {
      const targetKanji = new Set(lesson.objectives.kanji.map((k) => k.ja));
      const knownKanji = getCumulativeObjectives(lesson.id)
        .kanji.map((k) => k.ja)
        .filter((k) => !targetKanji.has(k));
      const out = await generateLesson(
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
      if (!out.storyJa.trim()) throw new Error("Histoire vide reçue.");
      await saveGeneratedLesson(lesson.id, out);
      await refresh();
      setOpenId(lesson.id);
    } catch (e) {
      setGenErrors((p) => ({ ...p, [lesson.id]: String(e) }));
      setState("error");
    }
  }

  async function start(lesson: Lesson) {
    if (!lesson.storyJa) return;
    await markLessonStarted(lesson.id);
    onOpenStory({
      lessonId: lesson.id,
      title: lesson.title,
      level: lesson.level,
      storyJa: lesson.storyJa,
      objectives: lesson.objectives,
    });
  }

  if (!lessons) return <p className={styles.empty}>Chargement…</p>;

  return (
    <div className={styles.wrap}>
      <header className={styles.intro}>
        <h2 className={styles.h2}>Parcours débutant</h2>
        <p className={styles.tagline}>
          Une petite leçon par jour. Chaque leçon t'introduit quelques mots et une règle, puis te
          fait lire une courte phrase qui les met en scène.
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
                    {v.yomi && v.yomi !== v.ja && (
                      <span className={styles.chipYomi}>{v.yomi}</span>
                    )}
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
                {lesson.state === "ready" ? (
                  <>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => setOpenId(open ? null : lesson.id)}
                    >
                      {open ? "Replier" : "Commencer"}
                    </button>
                    <button className={styles.btn} onClick={() => void start(lesson)}>
                      Lire directement
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void generate(lesson)}
                      disabled={busy}
                    >
                      {busy ? "Génération…" : "Générer cette leçon"}
                    </button>
                    {gs && <span className={styles.meta}>Statut : {STATE_LABEL[gs]}</span>}
                  </>
                )}
              </div>

              {err && <p className={styles.error}>{err}</p>}

              {open && lesson.intro && (
                <div className={styles.panel}>
                  <h3 className={styles.panelH3}>Leçon</h3>
                  <Markdown text={lesson.intro} />

                  <h3 className={styles.panelH3}>Tu vas rencontrer</h3>
                  <dl className={styles.objList}>
                    {lesson.objectives.vocab.length > 0 && (
                      <>
                        <dt>Vocabulaire</dt>
                        <dd>
                          <ul className={styles.objRows}>
                            {lesson.objectives.vocab.map((v) => (
                              <li key={v.ja}>
                                <span className={styles.objJa}>{v.ja}</span>
                                {v.yomi && v.yomi !== v.ja && (
                                  <span className={styles.objYomi}>{v.yomi}</span>
                                )}
                                <span className={styles.objFr}>{v.fr}</span>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </>
                    )}
                    {lesson.objectives.kanji.length > 0 && (
                      <>
                        <dt>Kanji</dt>
                        <dd>
                          <ul className={styles.objRows}>
                            {lesson.objectives.kanji.map((k) => (
                              <li key={k.ja}>
                                <span className={styles.objJa}>{k.ja}</span>
                                <span className={styles.objFr}>{k.fr}</span>
                              </li>
                            ))}
                          </ul>
                        </dd>
                      </>
                    )}
                    {lesson.objectives.grammar.length > 0 && (
                      <>
                        <dt>Grammaire</dt>
                        <dd>{lesson.objectives.grammar.join(" · ")}</dd>
                      </>
                    )}
                  </dl>

                  <div className={styles.actions}>
                    <button
                      className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={() => void start(lesson)}
                    >
                      Lire l'histoire →
                    </button>
                    {lesson.source === "generated" && (
                      <button className={styles.btn} onClick={() => void generate(lesson)} disabled={busy}>
                        Regénérer
                      </button>
                    )}
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
