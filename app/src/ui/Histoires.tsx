import { useEffect, useMemo, useState } from "react";
import { allStories, deleteStory, type StoryRecord } from "../lib/db";
import { getCurriculum } from "../lib/lessons";
import { GeneratePanel } from "./GeneratePanel";

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
    <div className="flex flex-col gap-6">
      {stories === null ? (
        <p className="text-muted">Chargement…</p>
      ) : stories.length === 0 ? (
        <p className="text-muted">
          Pas encore d'histoire — démarre une leçon dans <strong>Apprendre</strong>, ou génère-en une
          ci-dessous.
        </p>
      ) : (
        <div className="flex flex-col">
          {stories.map((s) => {
            const lesson = s.lessonId ? lessonTitles.get(s.lessonId) : undefined;
            return (
              <div
                key={s.id}
                className="flex flex-col gap-2 border-t border-hairline py-4 last:border-b"
              >
                <span className="font-jp text-lg">{s.title}</span>
                <span className="text-xs text-muted">
                  {new Date(s.createdAt).toLocaleString("fr-FR")}
                </span>
                {(lesson || chips(s.params).length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {lesson && (
                      <span className="rounded-sm border border-accent px-2 py-0.5 text-xs text-accent">
                        Leçon {lesson.order.toString().padStart(2, "0")} — {lesson.title}
                      </span>
                    )}
                    {chips(s.params).map((c) => (
                      <span
                        key={c}
                        className="rounded-sm border border-hairline px-2 py-0.5 text-xs text-muted"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 flex gap-3">
                  <button
                    className="cursor-pointer rounded-sm border border-hairline px-3 py-1 text-sm text-text transition-colors hover:border-accent"
                    onClick={() => onOpen(s)}
                  >
                    Ouvrir
                  </button>
                  <button
                    className="cursor-pointer rounded-sm border border-hairline px-3 py-1 text-sm text-text transition-colors hover:border-accent hover:text-accent"
                    onClick={() => void remove(s.id)}
                  >
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
