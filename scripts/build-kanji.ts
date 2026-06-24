// Pipeline KanjiDic2 → data/full/kanji.json (lectures, sens FR/EN, JLPT).
// Source : EDRDG KanjiDic2 (licence CC BY-SA). Exécuter avec réseau : `npm run data:kanji`.
// NB : extraction par bloc <character> (suffisante et sans dépendance XML lourde).

import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "full", "kanji.json");

interface KanjiRecord {
  kanji: string;
  meanings: string[];
  on: string[];
  kun: string[];
  jlpt: number | null;
  strokes: number | null;
}

function textBetween(block: string, tag: string, attr?: string): string[] {
  const re = attr
    ? new RegExp(`<${tag}[^>]*${attr}[^>]*>([^<]*)</${tag}>`, "g")
    : new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
}

async function main() {
  console.log(`[kanji] téléchargement ${SRC}…`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");

  const records: KanjiRecord[] = [];
  for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
    const block = m[1];
    const kanji = textBetween(block, "literal")[0];
    if (!kanji) continue;
    // readings : on-yomi (r_type="ja_on") / kun-yomi (r_type="ja_kun")
    const on: string[] = [];
    const kun: string[] = [];
    for (const r of block.matchAll(/<reading r_type="(ja_on|ja_kun)">([^<]*)<\/reading>/g)) {
      (r[1] === "ja_on" ? on : kun).push(r[2]);
    }
    const meanings: string[] = [];
    // sens sans attribut m_lang = anglais ; m_lang="fr" = français (priorité au FR si présent)
    const fr = [...block.matchAll(/<meaning m_lang="fr">([^<]*)<\/meaning>/g)].map((x) => x[1]);
    const en = [...block.matchAll(/<meaning>([^<]*)<\/meaning>/g)].map((x) => x[1]);
    meanings.push(...(fr.length ? fr : en));
    const jlptStr = textBetween(block, "jlpt")[0];
    const strokesStr = textBetween(block, "stroke_count")[0];
    records.push({
      kanji,
      meanings,
      on,
      kun,
      jlpt: jlptStr ? Number(jlptStr) : null,
      strokes: strokesStr ? Number(strokesStr) : null,
    });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(records));
  console.log(`[kanji] ${records.length} kanji écrits → ${OUT}`);
}

main().catch((e) => {
  console.error("[kanji] échec :", e);
  process.exit(1);
});
