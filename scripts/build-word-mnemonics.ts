// Corpus statique de moyens mnémotechniques par MOT (vocabulaire) — un jeu {lecture, sens,
// composition} par mot de l'inventaire. Généré PAR LOTS via le Worker (kind "word-mnemonic",
// un appel pour ~BATCH mots, cache R2 → relances gratuites), écrit dans
// app/src/data/inventory/vocab-mnemonics.json (frère de vocab.json). Reprise : les entrées
// présentes sont sautées (sauf --refresh). Le rendu (fiche mot) fusionne ce fichier à
// l'exécution. Pendant complémentaire de build-mnemonics.ts (niveau kanji).
//
//   npm run data:word-mnemonics                       # tout le vocabulaire de l'inventaire
//   npm run data:word-mnemonics -- --level 5          # seulement le vocab N5
//   npm run data:word-mnemonics -- --limit 20         # test rapide sur 20 mots
//   npm run data:word-mnemonics -- --refresh          # ignore le cache R2 ET les entrées existantes
//   WORKER_URL=https://… npm run data:word-mnemonics  # cibler un autre Worker

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mnemonic } from "../app/src/lib/genParsers";
import { generateBatched } from "./generate-batched";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "vocab-mnemonics.json");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

/** Taille d'un lot (≤ LIMITS.mnemonicItemsList côté Worker) : lots plus courts = réponse plus rapide. */
const BATCH = 5;
/** Lots simultanés : divise le temps total ; modéré pour rester sous les limites du fournisseur. */
const CONCURRENCY = 3;
/** Espacement entre lots d'un même slot : évite les 429 du fournisseur. */
const GAP_MS = 1000;

interface VocabInvEntry {
  id: string;
  level: number;
  surface: string;
  reading: string;
  fr?: string;
  meanings: string[];
}
interface KanjiInvEntry {
  id: string;
  fr?: string;
  meanings: string[];
}

const vocabAll = read<VocabInvEntry[]>(join(INV, "vocab.json"));
const vocabFr = read<Record<string, string>>(join(INV, "vocab-fr.json"));
const kanjiById = new Map(read<KanjiInvEntry[]>(join(INV, "kanji.json")).map((k) => [k.id, k]));

const frOf = (v: VocabInvEntry): string => v.fr ?? vocabFr[v.id] ?? v.meanings[0] ?? "";

/** Glose « 漢字 = sens » de chaque kanji du mot (matière à l'axe composition). */
function kanjiGloss(surface: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of surface) {
    if (!/\p{Script=Han}/u.test(ch) || seen.has(ch)) continue;
    seen.add(ch);
    const k = kanjiById.get(ch);
    out.push(`${ch} = ${k?.fr ?? k?.meanings[0] ?? "?"}`);
  }
  return out;
}

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
  let pool = vocabAll;
  if (args.level) pool = pool.filter((v) => v.level === args.level);
  if (args.limit) pool = pool.slice(0, args.limit);

  const existing: Record<string, Mnemonic> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, Mnemonic> = { ...existing };

  console.log(`Worker : ${WORKER_URL}`);
  console.log(
    `Mots : ${pool.length}${args.level ? ` (N${args.level})` : ""}${args.refresh ? " (refresh)" : ""} — lots de ${BATCH}`,
  );

  await generateBatched<VocabInvEntry>({
    items: pool,
    idOf: (v) => v.id,
    labelOf: (v) => v.surface,
    toBody: (batch) => ({
      kind: "word-mnemonic",
      items: batch.map((v) => ({
        ja: v.surface,
        yomi: v.reading,
        fr: frOf(v),
        components: kanjiGloss(v.surface),
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
