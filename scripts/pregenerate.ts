// Pré-génération en lot — remplit le cache R2 du Worker avec le MAXIMUM de contenu.
//
// Idée : tout ce que le Worker génère est mis en cache sur R2 sous une clé déterministe
// (cf. worker/src/cache.ts). Ce script parcourt TOUT le curriculum et déclenche, pour
// chaque leçon, la génération de son cours, d'une histoire, de la traduction de cette
// histoire et de son QCM de compréhension. Chaque appel passe par le Worker (qui détient
// les clés) → le résultat atterrit dans R2. Ensuite, l'app sert ce déjà-fait sans rappeler
// Gemini : on « économise les tokens ».
//
// Idempotent : un second passage tombe sur le cache (gratuit). `--refresh` force tout à
// être régénéré. Aucune clé ici : on ne parle qu'au Worker.
//
//   npm run content:batch                       # tout le curriculum
//   npm run content:batch -- --level 5          # seulement N5
//   npm run content:batch -- --limit 3          # 3 premières leçons (test rapide)
//   npm run content:batch -- --lesson-only      # cours seuls (pas d'histoires)
//   npm run content:batch -- --refresh          # ignore le cache, régénère
//   WORKER_URL=https://… npm run content:batch  # cibler un autre Worker

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` et non `??` : en CI, une variable de repo absente arrive en chaîne vide.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

// ---- Inventaire (miroir minimal de app/src/lib/inventory.ts) ----------------

interface VocabInv { id: string; level: number; surface: string; reading: string; fr?: string; meanings: string[] }
interface GrammarInv { id: string; level: number; name: string; ruleFr: string }

const vocabById = new Map(read<VocabInv[]>(join(INV, "vocab.json")).map((v) => [v.id, v]));
const grammarById = new Map(
  read<{ items: GrammarInv[] }>(join(INV, "grammar.json")).items.map((g) => [g.id, g]),
);
const vocabFr = read<Record<string, string>>(join(INV, "vocab-fr.json"));

interface VocabEntry { ja: string; yomi?: string; fr: string }

function resolveVocab(id: string): VocabEntry {
  const v = vocabById.get(id);
  if (v) {
    return {
      ja: v.surface,
      yomi: v.reading && v.reading !== v.surface ? v.reading : undefined,
      fr: v.fr ?? vocabFr[id] ?? v.meanings[0] ?? "",
    };
  }
  const [surface, reading] = id.split("|");
  return { ja: surface, yomi: reading && reading !== surface ? reading : undefined, fr: vocabFr[id] ?? "" };
}
function resolveGrammar(id: string): string {
  const g = grammarById.get(id);
  return g ? `${g.name} — ${g.ruleFr}` : id;
}

// ---- Curriculum (miroir minimal de app/src/lib/lessons.ts) ------------------

interface Introduces { vocab: string[]; grammar: string[] }
interface RawLesson { id: string; order: number; rev?: number; title: string; introduces: Introduces }
interface RawUnit { lessons: RawLesson[] }
interface RawLevel { level: number; units: RawUnit[] }
interface CurriculumFile { levels: RawLevel[] }

interface Entry {
  id: string;
  order: number;
  rev: number;
  level: number;
  title: string;
  introduces: Introduces;
  vocab: VocabEntry[];
  grammar: string[];
}

const curriculum = read<CurriculumFile>(join(ROOT, "app", "src", "data", "curriculum.json"));
const ENTRIES: Entry[] = curriculum.levels
  .flatMap((lvl) =>
    lvl.units.flatMap((u) =>
      u.lessons.map((l) => ({
        id: l.id,
        order: l.order,
        rev: l.rev ?? 1,
        level: lvl.level,
        title: l.title,
        introduces: l.introduces,
        vocab: l.introduces.vocab.map(resolveVocab),
        grammar: l.introduces.grammar.map(resolveGrammar),
      })),
    ),
  )
  .sort((a, b) => (a.level !== b.level ? b.level - a.level : a.order - b.order));

/** Découpe un texte japonais en phrases (miroir de splitJaSentences, app/src/lib/stories.ts). */
function splitJaSentences(text: string): string[] {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---- Appels Worker ----------------------------------------------------------

interface Args { level?: number; limit?: number; lessonOnly: boolean; refresh: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { lessonOnly: false, refresh: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--level") a.level = Number(argv[++i]);
    else if (arg === "--limit") a.limit = Number(argv[++i]);
    else if (arg === "--lesson-only") a.lessonOnly = true;
    else if (arg === "--refresh") a.refresh = true;
  }
  return a;
}

let stubSeen = false;
const stats = { ok: 0, cached: 0, failed: 0 };

/** Poste une requête de génération au Worker ; renvoie le texte (ou null en cas d'échec). */
async function gen(label: string, body: Record<string, unknown>, refresh: boolean): Promise<string | null> {
  try {
    const res = await fetch(`${WORKER_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...(refresh ? { refresh: true } : {}) }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; cached?: boolean; error?: string };
    if (!res.ok || data.error || !data.text) {
      stats.failed++;
      console.warn(`  ✗ ${label} — ${data.error ?? `HTTP ${res.status}`}`);
      return null;
    }
    if (data.text.startsWith("【stub】")) stubSeen = true;
    if (data.cached) stats.cached++;
    else stats.ok++;
    console.log(`  ${data.cached ? "•" : "✓"} ${label}${data.cached ? " (cache)" : ""}`);
    return data.text;
  } catch (e) {
    stats.failed++;
    console.warn(`  ✗ ${label} — ${String(e)}`);
    return null;
  }
}

async function processLesson(e: Entry, args: Args): Promise<void> {
  console.log(`\n[N${e.level} #${e.order}] ${e.id} — ${e.title}`);
  const common = { lessonId: e.id, level: e.level, title: e.title, vocab: e.vocab, grammar: e.grammar };

  await gen("cours (lesson)", { kind: "lesson", ...common, lessonOrder: e.order, rev: e.rev }, args.refresh);
  if (args.lessonOnly) return;

  const story = await gen(
    "histoire (lesson-story) v1",
    { kind: "lesson-story", ...common, variant: 1 },
    args.refresh,
  );
  if (!story) return;

  const sentences = splitJaSentences(story);
  if (sentences.length === 0) return;
  await gen("traduction (story-translation)", { kind: "story-translation", level: e.level, sentences }, args.refresh);
  await gen("QCM (comprehension-qcm)", { kind: "comprehension-qcm", level: e.level, sentences, grammar: e.grammar }, args.refresh);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let targets = ENTRIES;
  if (args.level) targets = targets.filter((e) => e.level === args.level);
  if (args.limit) targets = targets.slice(0, args.limit);

  console.log(`Worker : ${WORKER_URL}`);
  console.log(`Leçons à traiter : ${targets.length}${args.refresh ? " (refresh)" : ""}${args.lessonOnly ? " (cours seuls)" : ""}`);

  for (const e of targets) {
    await processLesson(e, args);
    if (stubSeen) {
      console.error(
        "\n⚠ Le Worker répond un « stub » : aucune clé configurée côté Worker.\n" +
          "  Configure TOGETHER_API_KEY (wrangler secret put TOGETHER_API_KEY) puis relance.",
      );
      process.exit(1);
    }
  }

  console.log(`\nTerminé — ${stats.ok} générés, ${stats.cached} déjà en cache, ${stats.failed} échecs.`);
  if (stats.failed > 0 && stats.ok === 0 && stats.cached === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
