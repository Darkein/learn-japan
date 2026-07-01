import { useEffect, useMemo, useState, type ReactNode } from "react";
import { annotateTokens, type RubySegment } from "../lib/furigana";
import { tokenize } from "../lib/tokenizer";
import { Ruby } from "./Ruby";

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
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }
    if (line.trim() === ":::") { i++; continue; }
    if (line.trim() === "---") { blocks.push({ kind: "hr" }); i++; continue; }

    const fenceMatch = line.match(/^\s*:::(\w+)/);
    if (fenceMatch) {
      const ftype = fenceMatch[1];
      i++;
      const body: string[] = [];
      let depth = 1;
      while (i < lines.length) {
        const bl = lines[i];
        if (/^\s*:::\w/.test(bl)) depth++;
        else if (bl.trim() === ":::") { depth--; if (depth === 0) break; }
        body.push(bl);
        i++;
      }
      i++;

      if (ftype === "example") {
        const pairs: { jp: string; fr?: string }[] = [];
        let pendingJp: string | null = null;
        for (const bl of body) {
          const tbl = bl.trim();
          if (tbl === "") continue;
          const quoteMatch = tbl.match(/^>\s*(.*)/);
          if (quoteMatch) {
            const fr = quoteMatch[1].trim();
            pairs.push({ jp: pendingJp ?? "", fr: fr || undefined });
            pendingJp = null;
          } else {
            if (pendingJp !== null) pairs.push({ jp: pendingJp });
            pendingJp = tbl;
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

    const headingMatch = line.match(/^\s*(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (headingMatch[1].length <= 3)
        blocks.push({ kind: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      i++;
      continue;
    }

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

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[-*]\s+/, "").trim());
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+\.\s+/, "").trim());
      blocks.push({ kind: "ol", items });
      continue;
    }

    const plines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") break;
      if (/^\s*:::/.test(l) || /^\s*#{1,6}\s/.test(l) || l.trim().startsWith("|") || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || l.trim() === "---") break;
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
