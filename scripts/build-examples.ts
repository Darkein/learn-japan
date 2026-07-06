// Corpus statique de phrases d'exemple — une phrase JA + traduction FR par mot de
// l'inventaire d'un niveau JLPT. Généré via le Worker (kind "vocab-examples", cache R2 →
// relances gratuites), puis VALIDÉ localement avec kuromoji : le mot cible doit apparaître
// dans la phrase et chaque token de contenu doit appartenir au lexique autorisé (mots des
// leçons précédentes pour un mot du curriculum, sinon inventaire cumulé des niveaux déjà
// enseignés — N5..niveau cible). Les phrases non conformes sont re-demandées une fois,
// puis laissées en trou plutôt que d'embarquer une donnée douteuse. Écrit
// app/src/data/inventory/examples.json — fichier FRÈRE de vocab.json (build-inventory.ts
// régénère vocab.json et écraserait des exemples embarqués).
//
//   npm run data:examples                        # inventaire N5 (défaut)
//   npm run data:examples -- --level 4           # mots N4 (lexique autorisé : N5+N4)
//   npm run data:examples -- --limit 40          # test rapide sur 40 mots
//   npm run data:examples -- --refresh           # ignore le cache R2, régénère
//   WORKER_URL=https://… npm run data:examples   # cibler un autre Worker

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "@sglkc/kuromoji";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "examples.json");
const DIC = join(ROOT, "node_modules", "@sglkc", "kuromoji", "dict");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

const BATCH = 20; // aligné sur LIMITS.exampleVocabList côté Worker
const ALLOWED_MAX = 400; // aligné sur LIMITS.allowedVocabList côté Worker

// ---- Inventaire & curriculum (miroir minimal, comme pregenerate.ts) ---------

interface VocabInv { id: string; level: number; surface: string; reading: string; fr?: string; meanings: string[] }
interface RawLesson { id: string; order: number; introduces: { vocab: string[]; grammar: string[] } }
interface RawUnit { lessons: RawLesson[] }
interface RawLevel { level: number; units: RawUnit[] }

const vocabAll = read<VocabInv[]>(join(INV, "vocab.json"));
const vocabFr = read<Record<string, string>>(join(INV, "vocab-fr.json"));
const curriculum = read<{ levels: RawLevel[] }>(join(ROOT, "app", "src", "data", "curriculum.json"));

// Ordre pédagogique global : niveau décroissant (N5 d'abord) PUIS ordre — `order`
// redémarre à 1 dans chaque niveau, un tri par ordre seul interclasserait les niveaux.
const lessonsOrdered: (RawLesson & { level: number })[] = curriculum.levels
  .flatMap((lvl) => lvl.units.flatMap((u) => u.lessons.map((l) => ({ ...l, level: lvl.level }))))
  .sort((a, b) => b.level - a.level || a.order - b.order);

/** Index de la leçon qui introduit chaque mot du curriculum. */
const lessonIndexByVocabId = new Map<string, number>();
lessonsOrdered.forEach((l, i) => {
  for (const id of l.introduces.vocab) {
    if (!lessonIndexByVocabId.has(id)) lessonIndexByVocabId.set(id, i);
  }
});

function frOf(v: VocabInv): string {
  return v.fr ?? vocabFr[v.id] ?? v.meanings[0] ?? "";
}

/** Formes acceptées d'un mot (pour le lexique autorisé et la détection du mot cible). */
function formsOf(v: VocabInv): string[] {
  return v.reading && v.reading !== v.surface ? [v.surface, v.reading] : [v.surface];
}

/** Lexique cumulé (surfaces + lectures) des leçons 0..idx incluses. */
function cumulativeForms(idx: number): Set<string> {
  const out = new Set<string>();
  const byId = new Map(vocabAll.map((v) => [v.id, v]));
  for (let i = 0; i <= idx; i++) {
    for (const id of lessonsOrdered[i].introduces.vocab) {
      const v = byId.get(id);
      if (v) for (const f of formsOf(v)) out.add(f);
    }
  }
  return out;
}

/** Lexique cumulé des niveaux déjà enseignés (N5..niveau cible) — rempli dans main(). */
let FULL_LEXICON = new Set<string>();

// ---- Lots : par leçon pour les mots du curriculum, par 20 pour le reste ------

interface Batch {
  words: VocabInv[];
  /** Lexique autorisé pour la VALIDATION (au-delà du mot cible lui-même). */
  allowed: Set<string>;
  label: string;
}

function buildBatches(level: number, limit?: number): Batch[] {
  let pool = vocabAll.filter((v) => v.level === level);
  if (limit) pool = pool.slice(0, limit);
  const inCurriculum = pool.filter((v) => lessonIndexByVocabId.has(v.id));
  const rest = pool.filter((v) => !lessonIndexByVocabId.has(v.id));

  const batches: Batch[] = [];
  // Mots du curriculum, groupés par leçon (lexique = leçons précédentes incluses).
  const byLesson = new Map<number, VocabInv[]>();
  for (const v of inCurriculum) {
    const idx = lessonIndexByVocabId.get(v.id)!;
    byLesson.set(idx, [...(byLesson.get(idx) ?? []), v]);
  }
  for (const [idx, words] of [...byLesson.entries()].sort((a, b) => a[0] - b[0])) {
    batches.push({ words, allowed: cumulativeForms(idx), label: `leçon ${lessonsOrdered[idx].id}` });
  }
  // Le reste : lots de 20, lexique = inventaire cumulé des niveaux enseignés.
  for (let i = 0; i < rest.length; i += BATCH) {
    batches.push({
      words: rest.slice(i, i + BATCH),
      allowed: FULL_LEXICON,
      label: `inventaire ${i + 1}-${Math.min(i + BATCH, rest.length)}`,
    });
  }
  return batches;
}

// ---- Génération (Worker) ------------------------------------------------------

async function generate(
  batch: Batch,
  level: number,
  refresh: boolean,
): Promise<Map<string, { ja: string; fr: string }>> {
  const body = {
    kind: "vocab-examples",
    level,
    vocab: batch.words.map((v) => ({
      ja: v.surface,
      yomi: v.reading !== v.surface ? v.reading : undefined,
      fr: frOf(v),
    })),
    allowedVocab: [...batch.allowed].slice(0, ALLOWED_MAX),
    ...(refresh ? { refresh: true } : {}),
  };
  const res = await fetch(`${WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; cached?: boolean; error?: string };
  if (!res.ok || data.error || !data.text) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  if (data.text.startsWith("【stub】")) {
    throw new Error("le Worker répond un stub : aucune clé Gemini configurée côté Worker");
  }
  // Une ligne par mot : « N. phrase japonaise || traduction française »
  const out = new Map<string, { ja: string; fr: string }>();
  for (const line of data.text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s*[.．]\s*(.+?)\s*\|\|\s*(.+?)\s*$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    const word = batch.words[idx];
    if (word) out.set(word.id, { ja: m[2], fr: m[3] });
  }
  return out;
}

// ---- Validation kuromoji ------------------------------------------------------

interface Token {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  basic_form: string;
}
interface Tokenizer { tokenize(text: string): Token[] }

function buildTokenizer(): Promise<Tokenizer> {
  return new Promise((resolve, reject) => {
    (kuromoji as { builder(o: { dicPath: string }): { build(cb: (err: unknown, tk: Tokenizer) => void): void } })
      .builder({ dicPath: DIC })
      .build((err, tk) => (err ? reject(err) : resolve(tk)));
  });
}

const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞"]);
/** Sous-catégories tolérées hors lexique : nombres, suffixes/compteurs, non-autonomes. */
const TOLERATED_DETAIL = new Set(["数", "接尾", "非自立", "代名詞"]);

/** null si conforme, sinon la raison du rejet. */
function validate(tk: Tokenizer, word: VocabInv, allowed: Set<string>, ja: string): string | null {
  const forms = formsOf(word);
  if (!forms.some((f) => ja.includes(f))) return `mot cible « ${word.surface} » absent`;
  const offenders: string[] = [];
  for (const t of tk.tokenize(ja)) {
    if (!CONTENT_POS.has(t.pos) || TOLERATED_DETAIL.has(t.pos_detail_1)) continue;
    const candidates = [t.surface_form, t.basic_form].filter((s) => s && s !== "*");
    const known =
      candidates.some((c) => allowed.has(c) || FULL_LEXICON.has(c)) ||
      forms.some((f) => candidates.includes(f) || f.includes(t.surface_form));
    if (!known) offenders.push(t.surface_form);
  }
  return offenders.length ? `hors lexique : ${offenders.join("、")}` : null;
}

// ---- Main ---------------------------------------------------------------------

interface Args { level: number; limit?: number; refresh: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { level: 5, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--level") a.level = Number(argv[++i]);
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]);
    else if (argv[i] === "--refresh") a.refresh = true;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Connaissance cumulée au moment où le niveau cible est étudié : N5..niveau cible.
  FULL_LEXICON = new Set(vocabAll.filter((v) => v.level >= args.level).flatMap(formsOf));
  const batches = buildBatches(args.level, args.limit);
  const total = batches.reduce((s, b) => s + b.words.length, 0);
  console.log(`Worker : ${WORKER_URL}`);
  console.log(`Niveau : N${args.level}. Mots : ${total} en ${batches.length} lots${args.refresh ? " (refresh)" : ""}`);

  console.log("Chargement du dictionnaire kuromoji…");
  const tk = await buildTokenizer();

  const existing: Record<string, { ja: string; fr: string }> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, { ja: string; fr: string }> = { ...existing };
  let ok = 0;
  let rejected = 0;
  let failed = 0;

  for (const batch of batches) {
    const wordsById = new Map(batch.words.map((w) => [w.id, w]));
    let pending = batch.words;
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      const sub: Batch = { ...batch, words: pending };
      let generated: Map<string, { ja: string; fr: string }>;
      try {
        // 2ᵉ tentative : refresh forcé, sinon le cache R2 resservirait la même phrase.
        generated = await generate(sub, args.level, args.refresh || attempt > 0);
      } catch (e) {
        failed += pending.length;
        console.warn(`✗ ${batch.label} — ${String(e)}`);
        pending = [];
        break;
      }
      const stillBad: VocabInv[] = [];
      for (const w of pending) {
        const ex = generated.get(w.id);
        const reason = ex ? validate(tk, w, batch.allowed, ex.ja) : "ligne manquante dans la réponse";
        if (ex && !reason) {
          results[w.id] = ex;
          ok++;
        } else {
          stillBad.push(w);
          if (attempt === 1) {
            rejected++;
            console.warn(`  ⚠ ${w.surface} (${w.id}) — ${reason}${ex ? ` — « ${ex.ja} »` : ""}`);
          }
        }
      }
      pending = stillBad;
    }
    console.log(`• ${batch.label} — ${wordsById.size} mots`);
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
  console.log(`\nTerminé — ${ok} exemples validés, ${rejected} rejetés (trous), ${failed} échecs réseau.`);
  console.log(`Corpus : ${Object.keys(results).length} entrées → ${OUT}`);
  if (ok === 0 && Object.keys(results).length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
