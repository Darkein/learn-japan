import { useEffect, useMemo, useState } from "react";
import { allStories, deleteStory, type StoryRecord } from "../lib/db";
import { getCurriculum, lessonsForGrammar } from "../lib/lessons";
import { GeneratePanel } from "./GeneratePanel";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { ReadabilityBadge } from "./ReadabilityBadge";

function chips(params: StoryRecord["params"]): string[] {
  const out: string[] = [];
  if (params.theme) out.push(`thème : ${params.theme}`);
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
            const derivedLessons = lessonsForGrammar(s.params.grammarIds ?? []).filter(
              (l) => l.id !== s.lessonId,
            );
            return (
              <div
                key={s.id}
                className="flex flex-col gap-2 border-t border-hairline py-4 last:border-b"
              >
                <span className="font-jp text-lg">{s.title}</span>
                <span className="text-sm text-muted">
                  {new Date(s.createdAt).toLocaleString("fr-FR")}
                </span>
                <div className="flex flex-wrap gap-2">
                  <ReadabilityBadge text={s.text} />
                  {lesson && (
                    <Badge variant="accent">
                      Leçon {lesson.order.toString().padStart(2, "0")} — {lesson.title}
                    </Badge>
                  )}
                  {derivedLessons.map((l) => (
                    <Badge key={l.id} variant="accent">
                      Leçon {l.order.toString().padStart(2, "0")} — {l.title}
                    </Badge>
                  ))}
                  {chips(s.params).map((c) => (
                    <Badge key={c}>{c}</Badge>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-3">
                  <Button onClick={() => onOpen(s)}>Ouvrir</Button>
                  <Button onClick={() => void remove(s.id)}>Supprimer</Button>
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
