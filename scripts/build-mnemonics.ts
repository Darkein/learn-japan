// Corpus statique de moyens mnémotechniques — un jeu {lecture, sens, forme} par kanji de
// l'inventaire. Généré via le Worker (kind "mnemonic", cache R2 → relances gratuites), puis
// écrit dans app/src/data/inventory/kanji-mnemonics.json — fichier FRÈRE de kanji.json (que
// build-inventory.ts régénère et écraserait). Reprise : les entrées déjà présentes sont
// sautées (sauf --refresh). Le rendu (fiche kanji) fusionne ce fichier à l'exécution.
//
//   npm run data:mnemonics                       # tous les kanji de l'inventaire
//   npm run data:mnemonics -- --level 5          # seulement les kanji N5
//   npm run data:mnemonics -- --limit 20         # test rapide sur 20 kanji
//   npm run data:mnemonics -- --refresh          # ignore le cache R2 ET les entrées existantes
//   WORKER_URL=https://… npm run data:mnemonics  # cibler un autre Worker

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMnemonic, type Mnemonic } from "../app/src/lib/genParsers";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "kanji-mnemonics.json");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

/** Espacement entre requêtes : évite les 429 du fournisseur (aligné sur GEN_GAP_MS client). */
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Un moyen mnémotechnique pour un kanji, ou null si le Worker ne renvoie rien d'exploitable. */
async function generate(k: KanjiInvEntry, refresh: boolean): Promise<Mnemonic | null> {
  const body = {
    kind: "mnemonic",
    kanji: k.id,
    meanings: k.meanings,
    on: k.on ?? [],
    kun: k.kun ?? [],
    strokes: k.strokes,
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
  let pool = kanjiAll;
  if (args.level) pool = pool.filter((k) => k.level === args.level);
  if (args.limit) pool = pool.slice(0, args.limit);

  const existing: Record<string, Mnemonic> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, Mnemonic> = { ...existing };

  console.log(`Worker : ${WORKER_URL}`);
  console.log(
    `Kanji : ${pool.length}${args.level ? ` (N${args.level})` : ""}${args.refresh ? " (refresh)" : ""}`,
  );

  const total = pool.length;
  const started = Date.now();
  const stats = { ok: 0, skipped: 0, empty: 0, failed: 0 };
  // Ratés collectés pour être listés À LA FIN : les afficher pendant le run casserait la
  // barre à une seule ligne.
  const problems: string[] = [];
  let done = 0;

  const isTty = process.stdout.isTTY === true;
  const BAR_WIDTH = 22;

  // Une barre de progression sur UNE ligne (jauge + %, compteur, ETA, kanji courant).
  const bar = (current: string): string => {
    const ratio = total ? done / total : 1;
    const filled = Math.round(BAR_WIDTH * ratio);
    const gauge = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
    const pct = String(Math.round(ratio * 100)).padStart(3);
    const elapsed = (Date.now() - started) / 1000;
    const rate = done / Math.max(elapsed, 0.001); // kanji/s
    const etaS = done > 1 && rate > 0 ? Math.round((total - done) / rate) : 0;
    const eta = etaS > 0 ? ` · ~${Math.floor(etaS / 60)}m${String(etaS % 60).padStart(2, "0")}` : "";
    const counts =
      `✓${stats.ok} ⏭${stats.skipped}` +
      (stats.empty ? ` ⚠${stats.empty}` : "") +
      (stats.failed ? ` ✗${stats.failed}` : "");
    return `${gauge} ${pct}% ${done}/${total} ${counts}${eta}  ${current}`;
  };

  // Rendu : TTY → réécrit la même ligne (\r + effacement de fin de ligne) ; sinon (CI, log
  // non interactif où \r est illisible) → une ligne périodique tous les 10 kanji.
  const draw = (current: string): void => {
    if (isTty) process.stdout.write(`\r${bar(current)}\x1b[K`);
    else if (done % 10 === 0 || done === total) console.log(bar(current));
  };

  for (const k of pool) {
    if (isTty) draw(`${k.id} …`); // feedback immédiat pendant l'appel réseau
    if (!args.refresh && results[k.id]) {
      stats.skipped++;
      done++;
      draw(k.id);
      continue;
    }
    try {
      const m = await generate(k, args.refresh);
      if (m) {
        results[k.id] = m;
        stats.ok++;
      } else {
        stats.empty++;
        problems.push(`⚠ ${k.id} — réponse non exploitable`);
      }
    } catch (e) {
      stats.failed++;
      problems.push(`✗ ${k.id} — ${String(e)}`);
    }
    done++;
    draw(k.id);
    // Sauvegarde incrémentale : une interruption ne perd pas le travail déjà fait.
    writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
    await sleep(GAP_MS);
  }

  if (isTty) process.stdout.write("\n"); // quitte la ligne de la barre

  if (problems.length) {
    console.log(`\n${problems.length} problème(s) :`);
    for (const p of problems) console.log(`  ${p}`);
  }
  console.log(
    `\nTerminé — ${stats.ok} générés, ${stats.skipped} déjà présents, ${stats.empty} vides, ${stats.failed} échecs.`,
  );
  console.log(`Corpus : ${Object.keys(results).length} entrées → ${OUT}`);
  if (stats.ok === 0 && Object.keys(results).length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
