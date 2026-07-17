// Parseur PUR du Markdown de leçon (cadrage généré) : blocs structurés — titres, listes,
// tableaux, exemples `:::example` (paires JP / traduction), encadrés `:::info|warning|…`.
// Aucun React ici : le rendu vit dans ui/LessonMarkdown.tsx.

import { stripFurigana } from "./podcastScript";

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "example"; pairs: { jp: string; fr?: string }[] }
  | { kind: "callout"; ctype: "info" | "warning" | "pitfall" | "summary"; body: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "para"; lines: string[] };

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }
    // Fermeture orpheline — tolère les variantes mal comptées du modèle (`::`, `::::`).
    if (/^:{2,}$/.test(line.trim())) { i++; continue; }
    if (line.trim() === "---") { blocks.push({ kind: "hr" }); i++; continue; }

    const fenceMatch = line.match(/^\s*:::(\w+)/);
    if (fenceMatch) {
      const ftype = fenceMatch[1];
      i++;
      const body: string[] = [];
      // Les encadrés (:::example/info/warning/pitfall/summary) NE s'imbriquent PAS.
      // Le corps court jusqu'à la ligne de fermeture `:::` — MAIS si le modèle l'oublie
      // (cela arrive), on borne quand même le bloc au prochain marqueur structurel :
      // un nouvel ouvreur `:::type` ou un titre `#`. Sans cette borne, un `:::pitfall`
      // non refermé avalait tout le reste de la leçon (dont le `:::summary` final), qui
      // se retrouvait rendu à l'intérieur de l'encadré.
      while (i < lines.length) {
        const bl = lines[i];
        // Fermeture explicite → consommée. Le modèle écrit parfois `::` ou `::::` au
        // lieu de `:::` : toute ligne faite uniquement de 2+ deux-points ferme le bloc.
        if (/^:{2,}$/.test(bl.trim())) { i++; break; }
        // Frontière d'un bloc non refermé : on clôt AVANT cette ligne, sans la
        // consommer, pour qu'elle soit reprise normalement par la boucle principale.
        if (/^\s*:::\w/.test(bl) || /^\s*#{1,6}\s/.test(bl)) break;
        body.push(bl);
        i++;
      }

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

    // Citation `>` hors :::example (le modèle réutilise parfois la convention
    // « phrase JP puis > glose » dans un encadré) : rendue en glose, pas en texte brut.
    if (/^\s*>/.test(line)) {
      const qlines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        qlines.push(lines[i++].replace(/^\s*>\s?/, "").trim());
      const filtered = qlines.filter(Boolean);
      if (filtered.length > 0) blocks.push({ kind: "quote", lines: filtered });
      continue;
    }

    const plines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") break;
      if (/^\s*:::/.test(l) || /^\s*#{1,6}\s/.test(l) || l.trim().startsWith("|") || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || /^\s*>/.test(l) || l.trim() === "---") break;
      plines.push(l);
      i++;
    }
    if (plines.length > 0) blocks.push({ kind: "para", lines: plines });
  }

  return blocks;
}

// ---------- Correspondance segment parlé → bloc affiché (suivi de lecture) ----------

/** Texte humain d'un bloc, concaténé (base de la correspondance segment → bloc). */
export function blockText(b: Block): string {
  switch (b.kind) {
    case "heading":
      return b.text;
    case "hr":
      return "";
    case "ul":
    case "ol":
      return b.items.join(" ");
    case "table":
      return [...b.head, ...b.rows.flat()].join(" ");
    case "example":
      return b.pairs.map((p) => `${p.jp} ${p.fr ?? ""}`).join(" ");
    case "callout":
      return b.body;
    case "quote":
    case "para":
      return b.lines.join(" ");
  }
}

/**
 * Forme normalisée pour la correspondance : furigana retiré, puis lettres/chiffres/
 * kana/kanji seuls, en minuscules. Le texte des segments parlés a traversé
 * stripMarkdown/stripFurigana (podcastScript) : cette normalisation rend ces
 * transformations sans importance des deux côtés.
 */
export function normalizeForMatch(s: string): string {
  return (
    stripFurigana(s)
      .toLowerCase()
      .match(/[a-zà-ÿ0-9぀-ヿ㐀-鿿ｦ-ﾟ]/g)
      ?.join("") ?? ""
  );
}

/**
 * Index du bloc affiché correspondant à un segment parlé du chapitre « cours ».
 * Recherche par inclusion du texte normalisé, à partir de `fromIndex` (la lecture est
 * linéaire : le biais évite les faux positifs des fragments courts), avec repli sur le
 * titre (niveau ≤ 2) égal au label du segment. -1 si rien ne correspond.
 */
export function findBlockForSegment(
  blocks: Block[],
  segText: string,
  segLabel: string | undefined,
  fromIndex = 0,
): number {
  const needle = normalizeForMatch(segText);
  if (needle.length >= 6 && blocks.length > 0) {
    const n = blocks.length;
    const start = Math.min(Math.max(fromIndex, 0), n - 1);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (normalizeForMatch(blockText(blocks[i])).includes(needle)) return i;
    }
  }
  const label = normalizeForMatch(segLabel ?? "");
  if (label) {
    const i = blocks.findIndex(
      (b) => b.kind === "heading" && b.level <= 2 && normalizeForMatch(b.text) === label,
    );
    if (i >= 0) return i;
  }
  return -1;
}
