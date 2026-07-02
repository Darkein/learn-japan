import { useEffect, useMemo, useState, type ReactNode } from "react";
import { parseBlocks, type Block } from "../lib/lessonMarkdown";
import { annotateTokens, type RubySegment } from "../lib/furigana";
import { tokenize } from "../lib/tokenizer";
import { Ruby } from "./Ruby";

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

export function Markdown({ text, reveal }: { text: string; reveal: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-4">
      {blocks.map((b, idx) => renderBlock(b, idx, reveal))}
    </div>
  );
}

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
