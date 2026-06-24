// Construit le référentiel JLPT (inventaire) à partir de datasets ouverts (MIT) :
//  - kanji : davidluzgouveia/kanji-data (agrège KANJIDIC + listes JLPT de Jonathan Waller).
//            On garde les champs dérivés KANJIDIC/Waller (sens EN, lectures, traits, niveau,
//            grade, fréquence) et on DROPE les champs WaniKani (wk_*) pour éviter toute question
//            de redistribution sur un repo public.
//  - vocab : jamsinclair/open-anki-jlpt-decks (dérivé des listes JLPT de Jonathan Waller).
//
// Les sens FRANÇAIS sont curés à la main dans des overlays committés (kanji-fr.json,
// vocab-fr.json) ; à défaut, repli sur l'anglais du dataset. La grammaire (grammar.json) est
// curée à la main et N'EST PAS générée par ce script.
//
// ⚠️ Listes JLPT non officielles : depuis 2010 la Japan Foundation ne publie plus de référentiel.
// Ces datasets sont des reconstructions communautaires (standards de facto). Cf. README / SPEC.
//
// Exécuter avec réseau : `npm run data:inventory`.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "app", "src", "data", "inventory");

const KANJI_SRC =
  "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json";
const VOCAB_N5_SRC =
  "https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n5.csv";

export interface KanjiInventoryEntry {
  id: string; // le caractère lui-même
  level: number; // niveau JLPT (5 = N5 … 1 = N1)
  fr?: string; // sens FR curé (overlay) — sinon repli sur `meanings`
  meanings: string[]; // sens anglais (KANJIDIC)
  on: string[];
  kun: string[];
  strokes: number | null;
  grade: number | null;
  freq: number | null;
}

export interface VocabInventoryEntry {
  id: string; // `${surface}|${reading}`
  level: number;
  surface: string;
  reading: string;
  fr?: string; // sens FR curé (overlay) — sinon repli sur `meanings`
  meanings: string[]; // sens anglais (Jonathan Waller)
}

/** kanji-data : forme brute d'une entrée (champs utiles seulement). */
interface RawKanji {
  jlpt_new: number | null;
  meanings?: string[];
  readings_on?: string[];
  readings_kun?: string[];
  strokes?: number;
  grade?: number | null;
  freq?: number | null;
}

function loadOverlay(file: string): Record<string, string> {
  const p = join(OUT_DIR, file);
  if (!existsSync(p)) {
    console.warn(`[inventory] overlay FR absent: ${file} (repli EN)`);
    return {};
  }
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
}

/** Parseur CSV minimal gérant les champs entre guillemets (avec virgules internes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
  }
  return rows;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return res.text();
}

async function buildKanji(): Promise<void> {
  console.log(`[inventory] kanji ← ${KANJI_SRC}`);
  const raw = JSON.parse(await fetchText(KANJI_SRC)) as Record<string, RawKanji>;
  const frOverlay = loadOverlay("kanji-fr.json");

  const entries: KanjiInventoryEntry[] = [];
  for (const [kanji, k] of Object.entries(raw)) {
    if (k.jlpt_new == null) continue; // seulement les kanji étiquetés JLPT (N5–N1)
    entries.push({
      id: kanji,
      level: k.jlpt_new,
      fr: frOverlay[kanji],
      meanings: k.meanings ?? [],
      on: k.readings_on ?? [],
      kun: k.readings_kun ?? [],
      strokes: k.strokes ?? null,
      grade: k.grade ?? null,
      freq: k.freq ?? null,
    });
  }
  // tri stable : niveau décroissant (N5 d'abord) puis fréquence croissante
  entries.sort((a, b) => b.level - a.level || (a.freq ?? 9999) - (b.freq ?? 9999));

  writeFileSync(join(OUT_DIR, "kanji.json"), JSON.stringify(entries, null, 0) + "\n");
  const n5 = entries.filter((e) => e.level === 5).length;
  console.log(`[inventory] ${entries.length} kanji écrits (dont ${n5} N5)`);
}

async function buildVocab(): Promise<void> {
  console.log(`[inventory] vocab N5 ← ${VOCAB_N5_SRC}`);
  const csv = parseCsv(await fetchText(VOCAB_N5_SRC));
  const header = csv[0];
  const iExpr = header.indexOf("expression");
  const iRead = header.indexOf("reading");
  const iMean = header.indexOf("meaning");
  const frOverlay = loadOverlay("vocab-fr.json");

  const seen = new Set<string>();
  const entries: VocabInventoryEntry[] = [];
  for (const r of csv.slice(1)) {
    const surface = r[iExpr]?.trim();
    const reading = (r[iRead]?.trim() || surface) ?? "";
    if (!surface) continue;
    const id = `${surface}|${reading}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const meanings = (r[iMean] ?? "")
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    entries.push({ id, level: 5, surface, reading, fr: frOverlay[id], meanings });
  }
  entries.sort((a, b) => a.reading.localeCompare(b.reading, "ja"));

  writeFileSync(join(OUT_DIR, "vocab.json"), JSON.stringify(entries, null, 0) + "\n");
  console.log(`[inventory] ${entries.length} mots N5 écrits`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await buildKanji();
  await buildVocab();
  console.log("[inventory] OK — grammar.json est curé à la main (non régénéré).");
}

main().catch((e) => {
  console.error("[inventory] échec :", e);
  process.exit(1);
});
