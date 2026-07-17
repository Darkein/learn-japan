// Boucle de génération PAR LOTS, partagée par build-mnemonics et build-word-mnemonics.
// Regroupe les items en lots (un seul appel LLM par lot), parse la réponse « N. a || b || c »,
// écrit incrémentalement, gère la reprise (items déjà présents sautés) et la barre de
// progression. Réduit fortement le nombre d'appels au Worker (≈ /batchSize).

import { writeFileSync } from "node:fs";
import { parseMnemonicBatch, type Mnemonic } from "../app/src/lib/genParsers";
import { createProgressBar } from "./progress";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BatchedOptions<T> {
  /** Tous les items du pool (repris inclus). */
  items: T[];
  /** Clé de stockage d'un item (= clé du JSON de sortie). */
  idOf: (item: T) => string;
  /** Libellé affiché dans la barre (surface, kanji…). */
  labelOf: (item: T) => string;
  /** Corps de requête pour un lot (sans `refresh`, ajouté par le lanceur). */
  toBody: (batch: T[]) => Record<string, unknown>;
  /** Résultats existants, mutés en place (sauvegarde incrémentale). */
  results: Record<string, Mnemonic>;
  outPath: string;
  workerUrl: string;
  refresh: boolean;
  batchSize: number;
  gapMs: number;
  /** Lots traités en parallèle (pool) : divise le temps total, borné par les 429 du fournisseur. */
  concurrency: number;
}

/** Un mnémo est exploitable s'il porte au moins l'histoire (la composition seule ne suffit pas). */
function usable(m: Mnemonic | null): m is Mnemonic {
  return !!m && !!m.story;
}

async function callWorker(
  workerUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${workerUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error || !data.text) throw new Error(data.error ?? `HTTP ${res.status}`);
  if (data.text.startsWith("【stub】")) {
    throw new Error("le Worker répond un stub : aucune clé configurée côté Worker (TOGETHER_API_KEY)");
  }
  return data.text;
}

/** Exécute la génération par lots ; renvoie les ratés (à lister en fin de run). */
export async function generateBatched<T>(opts: BatchedOptions<T>): Promise<string[]> {
  const { items, idOf, labelOf, toBody, results, outPath, workerUrl, refresh, batchSize, gapMs } = opts;
  const problems: string[] = [];

  // Phase 1 : sépare les repris (comptés d'emblée) des items à générer.
  const todo: T[] = [];
  const toProcess = refresh ? items.length : items.filter((it) => !results[idOf(it)]).length;
  const bar = createProgressBar(items.length, toProcess);
  for (const it of items) {
    if (!refresh && results[idOf(it)]) bar.tick("skipped", labelOf(it));
    else todo.push(it);
  }

  // Phase 2 : lots, traités en PARALLÈLE (pool de `concurrency` requêtes simultanées).
  // Le temps d'un appel LLM est dominé par les tokens de sortie : séquentiel, N lots
  // coûtent N × durée d'un lot ; en parallèle, le temps total est divisé par le pool.
  // Les mutations de `results`/barre restent sûres (event loop mono-thread).
  const lots: T[][] = [];
  for (let i = 0; i < todo.length; i += batchSize) lots.push(todo.slice(i, i + batchSize));

  let nextLot = 0;
  const runSlot = async (): Promise<void> => {
    for (;;) {
      const idx = nextLot++;
      if (idx >= lots.length) return;
      const batch = lots[idx];
      bar.preview(labelOf(batch[0]));
      let parsed: (Mnemonic | null)[];
      try {
        const text = await callWorker(workerUrl, {
          ...toBody(batch),
          ...(refresh ? { refresh: true } : {}),
        });
        parsed = parseMnemonicBatch(text, batch.length);
      } catch (e) {
        for (const it of batch) {
          problems.push(`✗ ${labelOf(it)} (${idOf(it)}) — ${String(e)}`);
          bar.tick("failed", labelOf(it));
        }
        await sleep(gapMs);
        continue;
      }
      batch.forEach((it, j) => {
        const m = parsed[j];
        if (usable(m)) {
          results[idOf(it)] = m;
          bar.tick("ok", labelOf(it));
        } else {
          problems.push(`⚠ ${labelOf(it)} (${idOf(it)}) — ligne manquante ou vide`);
          bar.tick("empty", labelOf(it));
        }
      });
      // Sauvegarde incrémentale : une interruption ne perd pas les lots déjà écrits.
      writeFileSync(outPath, JSON.stringify(results, null, 1) + "\n");
      await sleep(gapMs);
    }
  };
  // Départs décalés (gapMs) pour ne pas ouvrir toutes les connexions au même instant.
  const slots = Math.max(1, Math.min(opts.concurrency, lots.length));
  await Promise.all(
    Array.from({ length: slots }, async (_, s) => {
      await sleep(s * gapMs);
      await runSlot();
    }),
  );

  bar.finish();

  if (problems.length) {
    console.log(`\n${problems.length} problème(s) :`);
    for (const p of problems) console.log(`  ${p}`);
  }
  const { ok, skipped, empty, failed } = bar.stats;
  console.log(
    `\nTerminé — ${ok} générés, ${skipped} déjà présents, ${empty} vides, ${failed} échecs.`,
  );
  console.log(`Corpus : ${Object.keys(results).length} entrées → ${outPath}`);
  return problems;
}
