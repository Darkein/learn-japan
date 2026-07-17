// Corpus statique de moyens mnémotechniques par MOT (vocabulaire) — un jeu {lecture, sens,
// composition} par mot de l'inventaire. Généré via le Worker (kind "word-mnemonic", cache R2
// → relances gratuites), écrit dans app/src/data/inventory/vocab-mnemonics.json — fichier
// FRÈRE de vocab.json. Reprise : les entrées présentes sont sautées (sauf --refresh). Le
// rendu (fiche mot) fusionne ce fichier à l'exécution. Pendant complémentaire de
// build-mnemonics.ts (niveau kanji).
//
//   npm run data:word-mnemonics                       # tout le vocabulaire de l'inventaire
//   npm run data:word-mnemonics -- --level 5          # seulement le vocab N5
//   npm run data:word-mnemonics -- --limit 20         # test rapide sur 20 mots
//   npm run data:word-mnemonics -- --refresh          # ignore le cache R2 ET les entrées existantes
//   WORKER_URL=https://… npm run data:word-mnemonics  # cibler un autre Worker

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMnemonic, type Mnemonic } from "../app/src/lib/genParsers";
import { createProgressBar } from "./progress";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "vocab-mnemonics.json");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

/** Espacement entre requêtes : évite les 429 du fournisseur (aligné sur GEN_GAP_MS client). */
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** Un moyen mnémotechnique pour un mot, ou null si le Worker ne renvoie rien d'exploitable. */
async function generate(v: VocabInvEntry, refresh: boolean): Promise<Mnemonic | null> {
  const body = {
    kind: "word-mnemonic",
    word: v.surface,
    yomi: v.reading,
    fr: frOf(v),
    components: kanjiGloss(v.surface),
    ...(refresh ? { refresh: true } : {}),
  };
  const res = await fetch(`${WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error || !data.text) throw new Error(data.error ?? `HTTP ${res.status}`);
  if (data.text.startsWith("【stub】")) {
    throw new Error("le Worker répond un stub : aucune clé configurée côté Worker (TOGETHER_API_KEY)");
  }
  return parseMnemonic(data.text);
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
    `Mots : ${pool.length}${args.level ? ` (N${args.level})` : ""}${args.refresh ? " (refresh)" : ""}`,
  );

  const total = pool.length;
  const problems: string[] = [];
  const toProcess = args.refresh ? total : pool.filter((v) => !results[v.id]).length;
  const bar = createProgressBar(total, toProcess);

  for (const v of pool) {
    bar.preview(v.surface);
    if (!args.refresh && results[v.id]) {
      bar.tick("skipped", v.surface);
      continue;
    }
    try {
      const m = await generate(v, args.refresh);
      if (m) {
        results[v.id] = m;
        bar.tick("ok", v.surface);
      } else {
        problems.push(`⚠ ${v.surface} (${v.id}) — réponse non exploitable`);
        bar.tick("empty", v.surface);
      }
    } catch (e) {
      problems.push(`✗ ${v.surface} (${v.id}) — ${String(e)}`);
      bar.tick("failed", v.surface);
    }
    // Sauvegarde incrémentale : une interruption ne perd pas le travail déjà fait.
    writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
    await sleep(GAP_MS);
  }

  bar.finish();

  if (problems.length) {
    console.log(`\n${problems.length} problème(s) :`);
    for (const p of problems) console.log(`  ${p}`);
  }
  const { ok, skipped, empty, failed } = bar.stats;
  console.log(
    `\nTerminé — ${ok} générés, ${skipped} déjà présents, ${empty} vides, ${failed} échecs.`,
  );
  console.log(`Corpus : ${Object.keys(results).length} entrées → ${OUT}`);
  if (ok === 0 && Object.keys(results).length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
