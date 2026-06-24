// Pipeline JMdict (français) → app/src/../public/jmdict-fr.json.gz : map "forme → gloss FR".
// Servi comme asset statique hors-bundle (comme le dico kuromoji sous /dict/), chargé à la
// demande par le lecteur puis mis en cache (IndexedDB). Gzippé pour rester léger dans le repo.
//
// Source : jmdict-simplified (https://github.com/scriptin/jmdict-simplified), fichier `jmdict-fre`
// (EDRDG JMdict, licence CC BY-SA ; outillage MIT). Joignable via GitHub (EDRDG direct est bloqué).
// Couverture FR partielle (~15k mots) ; les mots absents retombent sur la forme de base.
//
// Exécuter avec réseau : `npm run data:jmdict`.

import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "app", "public", "jmdict-fr.json.gz");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

interface JmdictWord {
  kanji: { text: string }[];
  kana: { text: string }[];
  sense: { gloss: { lang: string; text: string }[] }[];
}

/** Extrait le premier fichier .json d'une archive tar (déjà dé-gzippée). */
function extractJsonFromTar(tar: Buffer): Buffer {
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    if (!name) break; // bloc de fin (zéros)
    const size = parseInt(header.toString("utf8", 124, 136).replace(/\0.*$/, "").trim(), 8) || 0;
    const start = off + 512;
    if (name.endsWith(".json")) return tar.subarray(start, start + size);
    off = start + Math.ceil(size / 512) * 512;
  }
  throw new Error("aucun .json dans l'archive tar");
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": "learn-japan-build" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`[jmdict] release ← ${RELEASE_API}`);
  const release = JSON.parse((await fetchBuffer(RELEASE_API)).toString("utf8")) as {
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find((a) => /^jmdict-fre-.*\.json\.tgz$/.test(a.name));
  if (!asset) throw new Error("asset jmdict-fre .json.tgz introuvable dans la dernière release");

  console.log(`[jmdict] téléchargement ${asset.name}…`);
  const tar = gunzipSync(await fetchBuffer(asset.browser_download_url));
  const data = JSON.parse(extractJsonFromTar(tar).toString("utf8")) as { words: JmdictWord[] };

  // Map forme (kanji ET kana) → gloss FR court. Premier sens, jusqu'à 3 glosses. Premier gagne.
  const map: Record<string, string> = {};
  for (const w of data.words) {
    const fre = w.sense.find((s) => s.gloss.some((g) => g.lang === "fre"));
    if (!fre) continue;
    const gloss = fre.gloss
      .filter((g) => g.lang === "fre")
      .slice(0, 3)
      .map((g) => g.text)
      .join(", ");
    if (!gloss) continue;
    for (const k of [...w.kanji.map((x) => x.text), ...w.kana.map((x) => x.text)]) {
      if (!(k in map)) map[k] = gloss;
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const json = Buffer.from(JSON.stringify(map), "utf8");
  writeFileSync(OUT, gzipSync(json, { level: 9 }));
  console.log(
    `[jmdict] ${Object.keys(map).length} formes (${data.words.length} mots) → ${OUT} ` +
      `(${(json.length / 1e6).toFixed(1)} Mo → ${(gzipSync(json, { level: 9 }).length / 1e6).toFixed(2)} Mo gz)`,
  );
}

main().catch((e) => {
  console.error("[jmdict] échec :", e);
  process.exit(1);
});
