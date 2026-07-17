// Corpus statique de moyens mnémotechniques KANJI — un jeu {lecture, sens, forme} par kanji
// de l'inventaire. Généré PAR LOTS via le Worker (kind "mnemonic", un appel pour ~BATCH kanji,
// cache R2 → relances gratuites), écrit dans app/src/data/inventory/kanji-mnemonics.json
// (frère de kanji.json). Reprise : les entrées présentes sont sautées (sauf --refresh). Le
// rendu (fiche kanji) fusionne ce fichier à l'exécution.
//
//   npm run data:mnemonics                       # tous les kanji de l'inventaire
//   npm run data:mnemonics -- --level 5          # seulement les kanji N5
//   npm run data:mnemonics -- --limit 20         # test rapide sur 20 kanji
//   npm run data:mnemonics -- --refresh          # ignore le cache R2 ET les entrées existantes
//   WORKER_URL=https://… npm run data:mnemonics  # cibler un autre Worker

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mnemonic } from "../app/src/lib/genParsers";
import { generateBatched } from "./generate-batched";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "kanji-mnemonics.json");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

/** Taille d'un lot (≤ LIMITS.mnemonicItemsList côté Worker) : lots plus courts = réponse plus rapide. */
const BATCH = 10;
/** Lots simultanés : divise le temps total ; modéré pour rester sous les limites du fournisseur. */
const CONCURRENCY = 3;
/** Espacement entre lots d'un même slot : évite les 429 du fournisseur. */
const GAP_MS = 1000;

interface KanjiInvEntry {
  id: string;
  level: number;
  fr?: string;
  meanings: string[];
  on?: string[];
  kun?: string[];
  strokes?: number;
}

const kanjiAll = read<KanjiInvEntry[]>(join(INV, "kanji.json"));

interface Args {
  level?: number;
  limit?: number;
  refresh: boolean;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { refresh: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--level") a.level = Number(argv[++i]);
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--refresh") a.refresh = true;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Efface la vue (les lignes « > … » de npm) pour partir sur un écran propre — TTY only.
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
  let pool = kanjiAll;
  if (args.level) pool = pool.filter((k) => k.level === args.level);
  if (args.limit) pool = pool.slice(0, args.limit);

  const existing: Record<string, Mnemonic> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, Mnemonic> = { ...existing };

  console.log(`Worker : ${WORKER_URL}`);
  console.log(
    `Kanji : ${pool.length}${args.level ? ` (N${args.level})` : ""}${args.refresh ? " (refresh)" : ""} — lots de ${BATCH}`,
  );

  await generateBatched<KanjiInvEntry>({
    items: pool,
    idOf: (k) => k.id,
    labelOf: (k) => k.id,
    toBody: (batch) => ({
      kind: "mnemonic",
      items: batch.map((k) => ({
        ja: k.id,
        fr: k.fr ?? k.meanings[0] ?? "",
        on: k.on ?? [],
        kun: k.kun ?? [],
        strokes: k.strokes,
      })),
    }),
    results,
    outPath: OUT,
    workerUrl: WORKER_URL,
    refresh: args.refresh,
    batchSize: BATCH,
    gapMs: GAP_MS,
    concurrency: CONCURRENCY,
  });

  if (Object.keys(results).length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
