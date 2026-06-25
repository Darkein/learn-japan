import { useEffect, useMemo, useState } from "react";
import { allStories, deleteStory, type StoryRecord } from "../lib/db";
import { getCurriculum } from "../lib/lessons";
import { GeneratePanel } from "./GeneratePanel";
import styles from "./Histoires.module.css";

function chips(params: StoryRecord["params"]): string[] {
  const out: string[] = [];
  if (params.theme) out.push(`thème : ${params.theme}`);
  if (params.kanji?.length) out.push(`kanji : ${params.kanji.join(" ")}`);
  if (params.grammar?.length) out.push(`grammaire : ${params.grammar.join(", ")}`);
  if (params.level) out.push(`N${params.level}`);
  return out;
}

interface Props {
  /** Ouvre une histoire dans la page de lecture. */
  onOpen: (story: StoryRecord) => void;
}

/** Onglet Histoires : liste seule des histoires enregistrées + panneau de génération. */
export function Histoires({ onOpen }: Props) {
  const [stories, setStories] = useState<StoryRecord[] | null>(null);
  const lessonTitles = useMemo(() => {
    const m = new Map<string, { order: number; title: string }>();
    for (const c of getCurriculum()) m.set(c.id, { order: c.order, title: c.title });
    return m;
  }, []);

  async function refresh() {
    setStories(await allStories());
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function remove(id: string) {
    await deleteStory(id);
    await refresh();
  }

  return (
    <div className={styles.wrap}>
      {stories === null ? (
        <p className={styles.empty}>Chargement…</p>
      ) : stories.length === 0 ? (
        <p className={styles.empty}>
          Pas encore d'histoire — démarre une leçon dans <strong>Apprendre</strong>, ou génère-en une
          ci-dessous.
        </p>
      ) : (
        <div className={styles.list}>
          {stories.map((s) => {
            const lesson = s.lessonId ? lessonTitles.get(s.lessonId) : undefined;
            return (
              <div key={s.id} className={styles.row}>
                <span className={styles.title}>{s.title}</span>
                <span className={styles.date}>{new Date(s.createdAt).toLocaleString("fr-FR")}</span>
                {(lesson || chips(s.params).length > 0) && (
                  <div className={styles.chips}>
                    {lesson && (
                      <span className={`${styles.chip} ${styles.lessonChip}`}>
                        Leçon {lesson.order.toString().padStart(2, "0")} — {lesson.title}
                      </span>
                    )}
                    {chips(s.params).map((c) => (
                      <span key={c} className={styles.chip}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <div className={styles.actions}>
                  <button className={styles.btn} onClick={() => onOpen(s)}>
                    Ouvrir
                  </button>
                  <button className={`${styles.btn} ${styles.del}`} onClick={() => void remove(s.id)}>
                    Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <GeneratePanel onGenerated={onOpen} />
    </div>
  );
}
