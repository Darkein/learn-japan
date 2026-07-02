// Parseur PUR du Markdown de leçon (cadrage généré) : blocs structurés — titres, listes,
// tableaux, exemples `:::example` (paires JP / traduction), encadrés `:::info|warning|…`.
// Aucun React ici : le rendu vit dans ui/LessonMarkdown.tsx.

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "example"; pairs: { jp: string; fr?: string }[] }
  | { kind: "callout"; ctype: "info" | "warning" | "pitfall" | "summary"; body: string }
  | { kind: "para"; lines: string[] };

export function parseBlocks(text: string): Block[] {
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
