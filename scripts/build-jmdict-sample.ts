// Pipeline JMdict (français) → data/full/jmdict-fr.json : map "forme de base → gloss FR".
// Source : EDRDG JMdict multi-langues (licence CC BY-SA). Les gloss FR ont xml:lang="fre".
// Couverture FR partielle → repli EN possible plus tard. Exécuter : `npm run data:jmdict`.

import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = "http://ftp.edrdg.org/pub/Nihongo/JMdict.gz";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "full", "jmdict-fr.json");

async function main() {
  console.log(`[jmdict] téléchargement ${SRC} (volumineux)…`);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");

  const map: Record<string, string> = {};
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    // forme de base : premier keb (kanji) sinon premier reb (kana)
    const key =
      block.match(/<keb>([^<]*)<\/keb>/)?.[1] ?? block.match(/<reb>([^<]*)<\/reb>/)?.[1];
    if (!key) continue;
    // gloss français du premier sens disponible
    const fr = block.match(/<gloss xml:lang="fre">([^<]*)<\/gloss>/)?.[1];
    if (!fr) continue;
    if (!(key in map)) map[key] = fr;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(map));
  console.log(`[jmdict] ${Object.keys(map).length} entrées FR écrites → ${OUT}`);
}

main().catch((e) => {
  console.error("[jmdict] échec :", e);
  process.exit(1);
});
