// Ordre des traits des kanji de l'inventaire → app/public/kanji-strokes-n{5..1}.json.gz
// (assets statiques gzippés, hors bundle, chargés à la demande — comme jmdict-fr.json.gz).
//
// Source : KanjiVG (CC BY-SA 3.0, cf. data/NOTICE.md), release épinglée dans scripts/kanjivg.ts.
// L'ORDRE des `<path>` dans le fichier EST l'ordre d'écriture : on ne garde que leur attribut
// `d`, sur la grille 109×109 de KanjiVG.
//
// Découpage par niveau JLPT : les 2211 kanji pèsent ≈ 545 Ko gzippés, et un débutant n'a rien
// à faire des tracés N1. Un fichier par niveau → 12 Ko pour N5, 328 Ko pour N1, chargés
// séparément (app/src/lib/strokes.ts).
//
// Coordonnées arrondies à UNE décimale : invisible sur une grille de 109 unités, et ça retire
// un quart du poids.
//
//   npm run data:strokes              # les 5 niveaux
//   npm run data:strokes -- --refresh # retélécharge l'asset KanjiVG (sinon cache data/full/)

import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKanjiVgXml, parseKanjiVg } from "./kanjivg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT_DIR = join(ROOT, "app", "public");

interface KanjiInvEntry {
  id: string;
  level: number;
  strokes?: number;
}

/** Arrondit chaque coordonnée à une décimale, sans toucher aux lettres de commande SVG. */
function shrink(d: string): string {
  return d.replace(/\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));
}

async function main(): Promise<void> {
  const inventory = JSON.parse(readFileSync(join(INV, "kanji.json"), "utf8")) as KanjiInvEntry[];
  const refresh = process.argv.includes("--refresh");

  const vg = parseKanjiVg(await loadKanjiVgXml(refresh));
  mkdirSync(OUT_DIR, { recursive: true });

  const byLevel = new Map<number, Record<string, string[]>>();
  let missing = 0;
  let strokeGap = 0;
  let total = 0;

  for (const k of inventory) {
    const entry = vg.get(k.id);
    if (!entry || entry.paths.length === 0) {
      missing += 1;
      continue;
    }
    if (k.strokes != null && entry.paths.length !== k.strokes) strokeGap += 1;
    const level = byLevel.get(k.level) ?? {};
    level[k.id] = entry.paths.map(shrink);
    byLevel.set(k.level, level);
    total += entry.paths.length;
  }

  for (const [level, kanji] of [...byLevel].sort((a, b) => b[0] - a[0])) {
    const out = join(OUT_DIR, `kanji-strokes-n${level}.json.gz`);
    const gz = gzipSync(Buffer.from(`${JSON.stringify(kanji, null, 0)}\n`, "utf8"), { level: 9 });
    writeFileSync(out, gz);
    console.log(
      `✓ kanji-strokes-n${level}.json.gz — ${Object.keys(kanji).length} kanji, ${Math.round(gz.byteLength / 1024)} Ko`,
    );
  }

  console.log(`  ${total} traits au total`);
  if (missing) console.warn(`⚠ ${missing} kanji de l'inventaire sans tracé dans KanjiVG`);
  if (strokeGap) console.warn(`⚠ ${strokeGap} kanji dont le compte de traits diffère de kanji.json`);
}

main().catch((e) => {
  console.error("[strokes] échec :", e);
  process.exit(1);
});
