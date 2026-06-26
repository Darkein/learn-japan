import { useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { grammarDetail, kanjiDetail } from "../lib/inventory";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { usePodcastPlayer } from "./usePodcastPlayer";
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
  const podcast = usePodcastPlayer();
  const podcastBusy = podcast.active && podcast.preparing !== null;

  const ready = lesson.state === "ready";

  async function read(story: StoryRecord) {
    if (story.lessonId) await markLessonStarted(story.lessonId);
    onOpenStory(story);
  }

  return (
    <div className="flex flex-col gap-4">
      <Cours lesson={lesson} />

      <div>
        <button
          className="cursor-pointer rounded-sm border border-accent px-4 py-2 text-sm text-accent transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => podcast.startLesson(lesson.id)}
          disabled={podcastBusy}
        >
          {podcastBusy ? `Préparation… ${podcast.preparing ?? ""}` : "▶ Mode podcast (écouter la leçon)"}
        </button>
        <p className="mt-1 text-xs text-muted">
          Cadrage parlé, quiz audio, puis l'histoire en écoute bilingue (japonais / français).
        </p>
      </div>

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

// Rendu minimaliste sans dépendance externe. Balises Markdown autorisées (et
// seules prises en compte) — voir aussi le prompt de génération qui les impose :
//   - titres de section : ligne débutant par « ## » ou « ### » ;
//   - paragraphes : séparés par une ligne vide ;
//   - retour à la ligne simple : conservé (<br/>) à l'intérieur d'un paragraphe ;
//   - listes à puces : lignes débutant par « - » ou « * » ;
//   - **gras** et *italique* en ligne.
function Markdown({ text }: { text: string }) {
  // Découpe en blocs sur les lignes vides ; chaque bloc est un titre, une liste ou un paragraphe.
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        const heading = block.match(/^(#{2,3})\s+(.*)$/);
        if (heading && lines.length === 1) {
          return (
            <h4
              key={i}
              className="mt-3 font-sans text-xs uppercase tracking-wider text-muted first:mt-0"
            >
              {inline(heading[2])}
            </h4>
          );
        }
        const isList = lines.every((l) => /^\s*[-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="ml-4 list-disc space-y-1">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// Inline autorisé : **gras** et *italique*. Le reste est rendu tel quel. Les passages
// japonais (kana/kanji), nombreux dans les exemples d'une leçon, sont rendus dans la
// police JP pour rester lisibles au milieu du texte français.
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) parts.push(...withJp(text.slice(last, m.index), `t${key}`));
    if (m[1] !== undefined) parts.push(<strong key={key++}>{withJp(m[1], `b${key}`)}</strong>);
    else parts.push(<em key={key++}>{withJp(m[2], `i${key}`)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(...withJp(text.slice(last), `t${key}`));
  return parts;
}

// Enveloppe les suites de caractères japonais (hiragana, katakana, kanji) dans la police
// JP, en laissant le texte français tel quel.
const CJK = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]+/g;
function withJp(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = CJK.exec(text)) != null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={`${keyBase}-${key++}`} className="font-jp">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
