// Gloses FRANÇAISES des composants de kanji qui ne sont PAS des kanji de l'inventaire
// (亻 宀 辶 頁 隹 艹…) → app/src/data/inventory/kanji-parts-fr.json.
//
// Les composants qui SONT des kanji de l'inventaire ont déjà un sens curé (kanji-fr.json) :
// ils sont exclus du pool, un corpus généré ne doit jamais écraser de la donnée curée. Restent
// ≈ 326 formes, glosées PAR LOTS via le Worker (kind "part-gloss", cache R2 → relances
// gratuites). Reprise : les entrées présentes sont sautées (sauf --refresh).
//
// Le fichier produit est plat et court : il est fait pour être RELU et corrigé à la main,
// comme kanji-fr.json.
//
//   npm run data:parts-fr                       # tous les composants sans glose
//   npm run data:parts-fr -- --limit 20         # test rapide (les 20 plus fréquents)
//   npm run data:parts-fr -- --refresh          # ignore le cache R2 ET les entrées existantes
//   WORKER_URL=https://… npm run data:parts-fr  # cibler un autre Worker
//
// Prérequis : `npm run data:parts` (kanji-parts.json), et un Worker DÉPLOYÉ qui connaît le
// kind "part-gloss" (deploy-worker.yml, sur push de worker/** vers main).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePartGlossBatch } from "../app/src/lib/genParsers";
import { generateBatched } from "./generate-batched";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "kanji-parts-fr.json");
const PARTS = join(INV, "kanji-parts.json");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

/** Taille d'un lot (≤ LIMITS.partItemsList = 40 côté Worker). Sortie minuscule → lots larges. */
const BATCH = 20;
/** Lots simultanés : divise le temps total ; modéré pour rester sous les limites du fournisseur. */
const CONCURRENCY = 3;
/** Espacement entre lots d'un même slot : évite les 429 du fournisseur. */
const GAP_MS = 1000;
/** Kanji-exemples envoyés pour désambiguïser un composant (le fil sémantique se voit). */
const EXAMPLES = 6;

interface RawPart {
  c: string;
  base?: string;
  phon?: number;
}
interface RawEntry {
  p: RawPart[];
}
interface KanjiInvEntry {
  id: string;
  level: number;
  fr?: string;
  meanings: string[];
  on?: string[];
}

/** Un composant à gloser, avec le contexte que le Worker n'a pas. */
interface Component {
  ch: string;
  /** Forme de base quand `ch` est une variante (亻 → 人). */
  base?: string;
  /** Lecture du kanji-hôte quand KanjiVG voit `ch` comme composant phonétique. */
  phon?: string;
  /** Kanji de l'inventaire qui le contiennent, du plus élémentaire au plus rare. */
  hosts: string[];
}

interface Args {
  limit?: number;
  refresh: boolean;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { refresh: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--refresh") a.refresh = true;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");

  if (!existsSync(PARTS)) {
    console.error(`${PARTS} absent — lance d'abord \`npm run data:parts\`.`);
    process.exit(1);
  }
  const parts = read<Record<string, RawEntry>>(PARTS);
  const kanji = read<KanjiInvEntry[]>(join(INV, "kanji.json"));
  const kanjiById = new Map(kanji.map((k) => [k.id, k]));
  const glossOf = (ch: string): string => {
    const k = kanjiById.get(ch);
    return k?.fr ?? k?.meanings[0] ?? "?";
  };

  // Index inverse composant → kanji-hôtes. `kanji.json` est trié N5 → N1, donc les hôtes
  // arrivent du plus élémentaire au plus rare : les exemples envoyés au modèle sont ceux
  // qu'un francophone reconnaîtra.
  const components = new Map<string, Component>();
  for (const k of kanji) {
    for (const part of parts[k.id]?.p ?? []) {
      // Les composants qui sont eux-mêmes des kanji de l'inventaire ont un sens CURÉ.
      if (kanjiById.has(part.base ?? part.c)) continue;
      const found = components.get(part.c);
      const comp = found ?? { ch: part.c, base: part.base, hosts: [] };
      comp.hosts.push(k.id);
      // La lecture du composant phonétique se lit sur son hôte : on prend la première
      // rencontrée, celle du kanji le plus élémentaire.
      if (part.phon && !comp.phon) comp.phon = kanjiById.get(k.id)?.on?.[0];
      if (!found) components.set(part.c, comp);
    }
  }

  // Les plus fréquents d'abord : un `--limit 20` de fumée tombe sur 艸 辶 宀, pas sur les
  // formes exotiques vues une seule fois.
  let pool = [...components.values()].sort((a, b) => b.hosts.length - a.hosts.length);
  if (args.limit) pool = pool.slice(0, args.limit);

  const existing: Record<string, string> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, string> = { ...existing };

  console.log(`Worker : ${WORKER_URL}`);
  console.log(
    `Composants sans sens curé : ${pool.length}${args.refresh ? " (refresh)" : ""} — lots de ${BATCH}`,
  );

  await generateBatched<Component, string>({
    items: pool,
    idOf: (c) => c.ch,
    labelOf: (c) => c.ch,
    toBody: (batch) => ({
      kind: "part-gloss",
      items: batch.map((c) => ({
        ja: c.ch,
        // `fr` porte la forme de base AVEC son sens curé (« 人 = personne ») : c'est le plus
        // sûr des désambiguïseurs, et le Worker n'a pas l'inventaire pour le retrouver.
        fr: c.base && kanjiById.has(c.base) ? `${c.base} = ${glossOf(c.base)}` : "",
        yomi: c.phon,
        components: c.hosts.slice(0, EXAMPLES).map((ch) => `${ch} = ${glossOf(ch)}`),
      })),
    }),
    results,
    parse: parsePartGlossBatch,
    usable: (g) => typeof g === "string" && g.length > 0,
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
