// Pipeline JMdict (français) → app/src/../public/jmdict-fr.json.gz : map "forme → gloss FR".
// Servi comme asset statique hors-bundle (comme le dico kuromoji sous /dict/), chargé à la
// demande par le lecteur puis mis en cache (IndexedDB). Gzippé pour rester léger dans le repo.
//
// Source : jmdict-simplified (https://github.com/scriptin/jmdict-simplified), fichier `jmdict-fre`
// (EDRDG JMdict, licence CC BY-SA ; outillage MIT). Joignable via GitHub (EDRDG direct est bloqué).
// Couverture FR partielle (~15k mots) ; les mots absents retombent sur la forme de base.
//
// Attribution des clés : plusieurs mots partagent souvent une même forme kana (いる :
// 居る/要る/射る/煎る…). Un « premier arrivé gagne » naïf donnait des glosses absurdes
// (いる → « abattre, tirer », ない → « décédé, mort »). On classe donc les candidats par
// fréquence (tags de priorité JMdict nfXX/ichi/spec/news/gai, snapshot data/jmdict-pri.json.gz
// — jmdict-simplified les résume en un booléen `common` trop grossier), avec un léger bonus
// pour les mots usuellement écrits en kana. Voir data/NOTICE.md pour la provenance du snapshot.
//
// Exécuter avec réseau : `npm run data:jmdict`.

import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "app", "public", "jmdict-fr.json.gz");
const PRI = join(ROOT, "data", "jmdict-pri.json.gz");
const RELEASE_API =
  "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

interface JmdictWord {
  id: string;
  kanji: { text: string; common: boolean }[];
  kana: { text: string; common: boolean }[];
  sense: { gloss: { lang: string; text: string }[]; misc?: string[] }[];
}

/** Scores de fréquence dérivés des tags de priorité JMdict (voir data/NOTICE.md). */
interface PriSnapshot {
  /** idseq → score max sur toutes les formes du mot (0..51). */
  entry: Record<string, number>;
  /** "idseq|forme kana" → score de CETTE forme (une lecture rare d'un mot fréquent
   * ne doit pas capter la clé kana : 地震【ない】 ne bat pas 無い). */
  kana: Record<string, number>;
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
  const headers: Record<string, string> = { "User-Agent": "learn-japan-build" };
  // Jeton optionnel (CI, workflow update-jmdict) : la limite anonyme de l'API GitHub
  // (60 req/h par IP) peut être épuisée sur un runner partagé. API seulement — le
  // téléchargement de l'asset redirige hors api.github.com et n'en a pas besoin.
  if (process.env.GITHUB_TOKEN && new URL(url).hostname === "api.github.com") {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
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
  const pri = JSON.parse(gunzipSync(readFileSync(PRI)).toString("utf8")) as PriSnapshot;

  // Map forme (kanji ET kana) → gloss FR court. Premier sens FR, jusqu'à 3 glosses.
  // Pour chaque forme, le candidat au meilleur score gagne (à score égal : ordre du fichier).
  const map: Record<string, string> = {};
  const best: Record<string, number> = {};
  const put = (key: string, gloss: string, score: number) => {
    if (!(key in map) || score > best[key]) {
      map[key] = gloss;
      best[key] = score;
    }
  };

  for (const w of data.words) {
    const fre = w.sense.find((s) => s.gloss.some((g) => g.lang === "fre"));
    if (!fre) continue;
    const gloss = fre.gloss
      .filter((g) => g.lang === "fre")
      .slice(0, 3)
      .map((g) => g.text)
      .join(", ");
    if (!gloss) continue;

    // « uk » = usually written using kana alone ; un mot sans kanji est kana par nature.
    const uk = w.sense.some((s) => s.misc?.includes("uk")) || w.kanji.length === 0;
    const bonus = uk ? 2 : 0;
    const entryScore =
      pri.entry[w.id] ?? (w.kanji.some((k) => k.common) || w.kana.some((k) => k.common) ? 10 : 0);

    for (const k of w.kanji) put(k.text, gloss, (entryScore + bonus) * 64 + entryScore);
    for (const k of w.kana) {
      const formScore = pri.kana[`${w.id}|${k.text}`] ?? (k.common ? 10 : 0);
      put(k.text, gloss, (formScore + bonus) * 64 + entryScore);
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
