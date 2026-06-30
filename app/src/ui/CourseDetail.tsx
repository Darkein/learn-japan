import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StoryRecord } from "../lib/db";
import { annotateTokens, type RubySegment } from "../lib/furigana";
import { grammarDetail } from "../lib/inventory";
import { markLessonStarted, type Lesson } from "../lib/lessons";
import { tokenize } from "../lib/tokenizer";
import { GenProgress } from "./GenProgress";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { Ruby } from "./Ruby";
import { useLessonGen } from "./useLessonGen";

interface Props {
  lesson: Lesson;
  /** Ouvre une histoire de leçon dans la page de lecture. */
  onOpenStory: (story: StoryRecord) => void;
  /** Lance une session de révision (optionnellement filtrée sur cette leçon). */
  onStartReview?: (opts?: { lessonId?: string; scope?: "due" | "all" }) => void;
}

/**
 * Détail d'un cours : cadrage + objectifs (grammaire / kanji / vocab) + histoires liées.
 * Rendu soit dans le panneau latéral (split desktop), soit dans une page dédiée (mobile).
 */
export function CourseDetail({ lesson, onOpenStory, onStartReview }: Props) {
  // Les histoires sont rendues directement depuis la leçon : le parent la recharge dès
  // qu'une génération aboutit (via `dataVersion` du contexte de génération).
  const stories = lesson.stories;
  const { job, busy, error, start, addStory, progress, label, retry, dismiss } =
    useLessonGen(lesson);
  const podcast = usePodcastPlayer();
  const podcastBusy = podcast.active && podcast.preparing !== null;

  const ready = lesson.state === "ready";
  const storyInProgress = busy && job?.phase === "story";

  const lessonId = lesson.id;
  useEffect(() => {
    if (!lesson.framing && !error) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

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

      {onStartReview && (
        <div>
          <button
            className="cursor-pointer rounded-sm border border-accent px-4 py-2 text-sm text-accent transition-colors hover:bg-accent hover:text-white"
            onClick={() => onStartReview({ lessonId: lesson.id, scope: "all" })}
          >
            S'entraîner sur cette leçon
          </button>
          <p className="mt-1 text-xs text-muted">
            Questions immédiates sur tout le vocabulaire, les kanji et la grammaire de cette leçon.
          </p>
        </div>
      )}

      {ready ? (
        <>
          <div className="mt-2 rounded-sm border border-hairline bg-surface px-4 py-4">
            <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Histoires</h3>
            <ul className="flex list-none flex-col gap-2">
              {stories.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="font-jp text-sm text-text">{s.title}</span>
                    {s.titleFr && <span className="ml-1 font-sans text-sm text-muted">({s.titleFr})</span>}
                  </span>
                  <button
                    className="cursor-pointer shrink-0 rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void read(s)}
                  >
                    Lire →
                  </button>
                </li>
              ))}
              {lesson.remoteStoryVariants.map((v) => (
                <li key={`remote-${v}`} className="flex items-center justify-between gap-3">
                  <span className="flex-1 text-sm text-muted italic">Histoire {v} (disponible)</span>
                  <button
                    className="cursor-pointer shrink-0 rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void addStory(v)}
                    disabled={busy}
                  >
                    {busy ? "Chargement…" : "Ouvrir →"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* L'histoire se génère après le cours : la leçon est lisible pendant ce temps. */}
          {storyInProgress && <GenProgress label={label} progress={progress} />}

          {!storyInProgress && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <button
                className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void addStory()}
                disabled={busy}
              >
                {busy ? "Génération…" : "Ajouter une histoire"}
              </button>
            </div>
          )}
        </>
      ) : (
        busy && <GenProgress label={label} progress={progress} />
      )}

      {error && (
        <p className="flex flex-wrap items-center gap-3 text-sm text-accent">
          {error}
          <button className="cursor-pointer underline" onClick={() => void retry()}>
            Réessayer
          </button>
          <button className="cursor-pointer text-muted underline" onClick={() => void dismiss()}>
            Ignorer
          </button>
        </p>
      )}
    </div>
  );
}

/** Cours d'une leçon : assemblé depuis l'inventaire (grammaire, kanji, vocab) + cadrage rédigé. */
function Cours({ lesson }: { lesson: Lesson }) {
  const [revealFurigana, setRevealFurigana] = useState(true);
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-sans text-sm uppercase tracking-widest text-muted">Le cours</h3>
        {lesson.framing && (
          <button
            className="cursor-pointer text-xs text-muted hover:text-text"
            onClick={() => setRevealFurigana((v) => !v)}
          >
            {revealFurigana ? "Masquer furigana" : "Afficher furigana"}
          </button>
        )}
      </div>
      {lesson.framing && <Markdown text={lesson.framing} reveal={revealFurigana} />}

      {(grammar.length > 0 || lesson.objectives.vocab.length > 0) && (
        <div className="mt-6 flex flex-col gap-4 rounded-sm border border-hairline bg-surface px-4 py-4">
          {grammar.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-xs uppercase tracking-wider text-muted">Grammaire</p>
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
            </div>
          )}
          {lesson.objectives.vocab.length > 0 && (
            <div>
              <p className="mb-2 font-sans text-xs uppercase tracking-wider text-muted">Vocabulaire</p>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Markdown parser ────────────────────────────────────────────────────────────
// Balises supportées (voir aussi le prompt de génération) :
//   # / ## / ###  titres
//   - /* / 1. 2.  listes à puces et numérotées
//   | … |         tables Markdown pipe
//   :::type … ::: blocs clôturés : example, info, warning, pitfall, summary
//   **gras**  *italique*  en ligne
//   japonais  → furigana kuromoji avec bascule afficher/masquer

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "example"; pairs: { jp: string; fr?: string }[] }
  | { kind: "callout"; ctype: "info" | "warning" | "pitfall" | "summary"; body: string }
  | { kind: "para"; lines: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Orphaned closing ::: — skip to avoid infinite loop
    if (line.trim() === ":::") { i++; continue; }

    // Horizontal rule
    if (line.trim() === "---") { blocks.push({ kind: "hr" }); i++; continue; }

    // Fenced block :::type … ::: with nested-depth tracking
    const fenceMatch = line.match(/^:::(\w+)\s*$/);
    if (fenceMatch) {
      const ftype = fenceMatch[1];
      i++;
      const body: string[] = [];
      let depth = 1;
      while (i < lines.length) {
        const bl = lines[i];
        if (/^:::\w/.test(bl)) depth++;
        else if (bl.trim() === ":::") { depth--; if (depth === 0) break; }
        body.push(bl);
        i++;
      }
      i++; // consume closing :::

      if (ftype === "example") {
        const pairs: { jp: string; fr?: string }[] = [];
        let pendingJp: string | null = null;
        for (const bl of body) {
          if (bl.trim() === "") continue;
          if (bl.startsWith("> ") || bl === ">") {
            pairs.push({ jp: pendingJp ?? "", fr: bl.startsWith("> ") ? bl.slice(2) : bl.slice(1) });
            pendingJp = null;
          } else {
            if (pendingJp !== null) pairs.push({ jp: pendingJp });
            pendingJp = bl;
          }
        }
        if (pendingJp !== null) pairs.push({ jp: pendingJp });
        const valid = pairs.filter((p) => p.jp !== "" || p.fr);
        if (valid.length > 0) blocks.push({ kind: "example", pairs: valid });
      } else if (ftype === "info" || ftype === "warning" || ftype === "pitfall" || ftype === "summary") {
        blocks.push({ kind: "callout", ctype: ftype, body: body.join("\n") });
      }
      continue;
    }

    // Heading # / ## / ### (4+ hashes silently skipped)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (headingMatch[1].length <= 3)
        blocks.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Table pipe
    if (line.trim().startsWith("|")) {
      const tlines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tlines.push(lines[i]); i++; }
      const parseRow = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim());
      const isSep = (l: string) => /^\|[\s\-:|]+\|$/.test(l.trim());
      const nonSep = tlines.filter((l) => !isSep(l));
      const [headLine, ...rowLines] = nonSep;
      if (headLine) blocks.push({ kind: "table", head: parseRow(headLine), rows: rowLines.map(parseRow) });
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+\.\s+/, ""));
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph — collect until blank line or block marker
    const plines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") break;
      if (/^:::/.test(l) || /^#{1,6}\s/.test(l) || l.trim().startsWith("|") || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || l.trim() === "---") break;
      plines.push(l);
      i++;
    }
    if (plines.length > 0) blocks.push({ kind: "para", lines: plines });
  }

  return blocks;
}

function renderBlock(b: Block, idx: number | string, reveal: boolean): ReactNode {
  if (b.kind === "heading") {
    const headingClass =
      b.level === 1
        ? "mt-8 mb-2 font-sans text-sm font-semibold text-accent first:mt-0"
        : b.level === 2
          ? "mt-6 mb-1 font-sans text-sm font-semibold text-text border-b border-hairline pb-0.5 first:mt-0"
          : "mt-4 mb-1 font-sans text-xs font-medium text-muted first:mt-0";
    return (
      <h4 key={idx} className={headingClass}>
        {inlineContent(b.text, `h${idx}`, reveal)}
      </h4>
    );
  }
  if (b.kind === "hr")
    return <hr key={idx} className="my-2 border-hairline" />;
  if (b.kind === "ul")
    return (
      <ul key={idx} className="ml-4 list-disc space-y-1">
        {b.items.map((item, j) => <li key={j}>{inlineContent(item, `ul${idx}-${j}`, reveal)}</li>)}
      </ul>
    );
  if (b.kind === "ol")
    return (
      <ol key={idx} className="ml-4 list-decimal space-y-1">
        {b.items.map((item, j) => <li key={j}>{inlineContent(item, `ol${idx}-${j}`, reveal)}</li>)}
      </ol>
    );
  if (b.kind === "table")
    return <TableBlock key={idx} head={b.head} rows={b.rows} reveal={reveal} />;
  if (b.kind === "example")
    return <ExampleBlock key={idx} pairs={b.pairs} reveal={reveal} />;
  if (b.kind === "callout")
    return <Callout key={idx} ctype={b.ctype} body={b.body} reveal={reveal} />;
  return (
    <p key={idx}>
      {b.lines.map((l, j) => (
        <span key={j}>
          {j > 0 && <br />}
          {inlineContent(l, `p${idx}-${j}`, reveal)}
        </span>
      ))}
    </p>
  );
}

function Markdown({ text, reveal }: { text: string; reveal: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-2">
      {blocks.map((b, idx) => renderBlock(b, idx, reveal))}
    </div>
  );
}

// ── Inline parsing ─────────────────────────────────────────────────────────────

function inlineContent(text: string, keyBase: string, reveal: boolean, markClassName?: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) parts.push(...withJpFurigana(text.slice(last, m.index), `${keyBase}-t${key}`, reveal));
    if (m[1] !== undefined) {
      parts.push(<strong key={`${keyBase}-b${key}`} className={["text-accent", markClassName].filter(Boolean).join(" ")}>{withJpFurigana(m[1], `${keyBase}-bs${key}`, reveal)}</strong>);
    } else {
      parts.push(<em key={`${keyBase}-i${key}`} className={markClassName}>{withJpFurigana(m[2], `${keyBase}-is${key}`, reveal)}</em>);
    }
    key++;
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(...withJpFurigana(text.slice(last), `${keyBase}-t${key}`, reveal));
  return parts;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]+/g;

function withJpFurigana(text: string, keyBase: string, reveal: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  CJK.lastIndex = 0;
  while ((m = CJK.exec(text)) != null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<JpText key={`${keyBase}-jp${key++}`} text={m[0]} reveal={reveal} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function JpText({ text, reveal }: { text: string; reveal: boolean }) {
  const [segments, setSegments] = useState<RubySegment[] | null>(null);

  useEffect(() => {
    if (!text.trim()) return;
    let cancelled = false;
    void tokenize(text).then((tokens) => {
      if (!cancelled) setSegments(annotateTokens(tokens).flatMap((t) => t.segments));
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  return (
    <span className="font-jp">
      {segments ? <Ruby segments={segments} reveal={reveal} /> : text}
    </span>
  );
}

// ── Blocks ─────────────────────────────────────────────────────────────────────

function ExampleBlock({ pairs, reveal }: { pairs: { jp: string; fr?: string }[]; reveal: boolean }) {
  return (
    <div className="my-3 space-y-3 rounded-sm border border-hairline bg-surface px-4 py-3">
      {pairs.map((pair, i) => (
        <div key={i}>
          {pair.jp && (
            <div className="font-jp text-lg leading-relaxed text-text">
              {inlineContent(pair.jp, `ex${i}-jp`, reveal, "font-jp")}
            </div>
          )}
          {pair.fr && <div className="mt-0.5 font-sans text-sm text-muted">{pair.fr}</div>}
        </div>
      ))}
    </div>
  );
}

const CALLOUT_CONFIG: Record<string, { borderColor: string; icon: string; label: string }> = {
  info: { borderColor: "var(--accent)", icon: "ℹ", label: "Note" },
  warning: { borderColor: "var(--accent)", icon: "⚠", label: "Attention" },
  pitfall: { borderColor: "var(--state-review)", icon: "✗", label: "Piège fréquent" },
  summary: { borderColor: "var(--accent)", icon: "★", label: "À retenir" },
};

function Callout({
  ctype,
  body,
  reveal,
}: {
  ctype: "info" | "warning" | "pitfall" | "summary";
  body: string;
  reveal: boolean;
}) {
  const cfg = CALLOUT_CONFIG[ctype] ?? CALLOUT_CONFIG.info;
  const blocks = useMemo(() => parseBlocks(body), [body]);
  return (
    <aside
      className="my-3 space-y-1 rounded-r-sm border-l-4 bg-surface px-4 py-3"
      style={{ borderLeftColor: cfg.borderColor }}
    >
      <p className="mb-1 font-sans text-xs uppercase tracking-wider text-muted">
        {cfg.icon} {cfg.label}
      </p>
      {blocks.map((b, i) => renderBlock(b, i, reveal))}
    </aside>
  );
}

function TableBlock({
  head,
  rows,
  reveal,
}: {
  head: string[];
  rows: string[][];
  reveal: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b border-hairline px-3 py-1.5 text-left font-sans text-xs uppercase tracking-wider text-muted"
              >
                {inlineContent(h, `th${i}`, reveal, "font-jp")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-hairline last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5">
                  {inlineContent(cell, `td${i}-${j}`, reveal, "font-jp")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
