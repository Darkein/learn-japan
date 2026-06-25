import { useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { grammarDetail, kanjiDetail } from "../lib/inventory";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { STATE_LABEL, useLessonGen } from "./useLessonGen";

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
    <div className="flex flex-col gap-4">
      <Cours lesson={lesson} />

      {ready ? (
        <>
          <h3 className="font-sans text-xs uppercase tracking-widest text-muted">Histoires</h3>
          <ul className="flex list-none flex-col gap-1">
            {stories.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3">
                <span className="flex-1 truncate font-jp text-muted">{s.text}</span>
                <button
                  className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void read(s)}
                >
                  Lire →
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void anotherStory()}
              disabled={busy}
            >
              {busy ? "Génération…" : "Générer une autre histoire"}
            </button>
            {genState && busy && (
              <span className="text-sm text-muted">Statut : {STATE_LABEL[genState]}</span>
            )}
          </div>
        </>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? "Génération…" : "Commencer la leçon"}
          </button>
          {genState && busy && (
            <span className="text-sm text-muted">Statut : {STATE_LABEL[genState]}</span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-accent">{error}</p>}
    </div>
  );
}

/** Cours d'une leçon : assemblé depuis l'inventaire (grammaire, kanji, vocab) + cadrage rédigé. */
function Cours({ lesson }: { lesson: Lesson }) {
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  const kanji = lesson.introduces.kanji.map(kanjiDetail).filter((k) => k !== null);
  return (
    <div>
      <h3 className="font-sans text-sm uppercase tracking-widest text-muted mb-2">Le cours</h3>
      {lesson.framing && <Markdown text={lesson.framing} />}

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
        {grammar.length > 0 && (
          <>
            <dt className="font-sans text-xs uppercase tracking-wider text-muted">Grammaire</dt>
            <dd className="m-0">
              <ul className="flex list-none flex-col gap-1">
                {grammar.map((g) => (
                  <li key={g.id} className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
                    <span className="font-jp text-sm text-text">{g.name}</span>
                    <span className="font-sans text-sm text-text">
                      {g.ruleFr} <em>ex. {g.exampleJa}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {kanji.length > 0 && (
          <>
            <dt className="font-sans text-xs uppercase tracking-wider text-muted">Kanji</dt>
            <dd className="m-0">
              <ul className="flex list-none flex-col gap-1">
                {kanji.map((k) => (
                  <li key={k.ja} className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
                    <span className="font-jp text-sm text-text">{k.ja}</span>
                    <span className="font-sans text-sm text-text">
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
            <dt className="font-sans text-xs uppercase tracking-wider text-muted">Vocabulaire</dt>
            <dd className="m-0">
              <ul className="flex list-none flex-col gap-1">
                {lesson.objectives.vocab.map((v) => (
                  <li key={v.ja} className="grid grid-cols-[6rem_1fr] items-baseline gap-3">
                    <span className="font-jp text-sm text-text">
                      {v.ja}
                      {v.yomi && v.yomi !== v.ja && (
                        <span className="ml-2 font-jp text-xs italic text-muted">{v.yomi}</span>
                      )}
                    </span>
                    <span className="font-sans text-sm text-text">{v.fr}</span>
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
    <div className="space-y-2">
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
