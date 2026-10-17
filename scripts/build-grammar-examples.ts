// Corpus statique de phrases PAR POINT de grammaire (SPEC §5.3) — jusqu'à trois phrases
// JA + traduction FR par point du curriculum, qui emploient sa forme dans le sens précis de
// sa règle. Elles nourrissent les exercices de grammaire du parcours (phrase à reconstruire,
// dictée) : sans elles, un point n'a que son exemple unique et l'étape le ressert à chaque
// fois. Généré via le Worker (kind "grammar-examples", cache R2 → relances gratuites), puis
// VALIDÉ localement avec kuromoji : la forme du point doit apparaître dans la phrase (comme
// particule ou auxiliaire quand elle tient en un kana — で de moyen, pas で au milieu d'un
// mot) et chaque token de contenu doit appartenir au lexique autorisé (mots des leçons déjà
// vues, plus l'inventaire des niveaux enseignés). Les phrases non conformes sont
// re-demandées une fois, puis écartées. Écrit app/src/data/inventory/grammar-examples.json.
//
//   npm run data:grammar-examples                    # tous les points du curriculum
//   npm run data:grammar-examples -- --level 5       # points des leçons N5 seulement
//   npm run data:grammar-examples -- --limit 10      # test rapide sur 10 points
//   npm run data:grammar-examples -- --refresh       # ignore le cache R2, régénère
//   WORKER_URL=https://… npm run data:grammar-examples

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kuromoji from "@sglkc/kuromoji";
import { grammarForm } from "../app/src/lib/inventory";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INV = join(ROOT, "app", "src", "data", "inventory");
const OUT = join(INV, "grammar-examples.json");
const DIC = join(ROOT, "node_modules", "@sglkc", "kuromoji", "dict");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

// `||` (pas `??`) : en CI la variable peut exister mais être VIDE → retomber sur le défaut.
const WORKER_URL = (process.env.WORKER_URL || "https://learn-japan-gen.learn-japan-gen.workers.dev").replace(
  /\/+$/,
  "",
);

const BATCH = 10; // aligné sur LIMITS.grammarPointsList côté Worker
const ALLOWED_MAX = 400; // aligné sur LIMITS.allowedVocabList côté Worker
const KEEP = 3; // phrases gardées par point
const MAX_LEN = 30; // au-delà, la phrase à reconstruire devient un puzzle

// ---- Inventaire & curriculum (miroir minimal, comme build-examples.ts) ---------

interface VocabInv { id: string; level: number; surface: string; reading: string }
interface GrammarInv { id: string; level: number; name: string; ruleFr: string; exampleJa?: string }
interface RawLesson { id: string; order: number; introduces: { vocab: string[]; grammar: string[] } }
interface RawUnit { lessons: RawLesson[] }
interface RawLevel { level: number; units: RawUnit[] }
interface Sentence { ja: string; fr: string }

const vocabAll = read<VocabInv[]>(join(INV, "vocab.json"));
const grammarAll = read<{ items: GrammarInv[] }>(join(INV, "grammar.json")).items;
const curriculum = read<{ levels: RawLevel[] }>(join(ROOT, "app", "src", "data", "curriculum.json"));

// Ordre pédagogique global : niveau décroissant (N5 d'abord) PUIS ordre.
const lessonsOrdered: (RawLesson & { level: number })[] = curriculum.levels
  .flatMap((lvl) => lvl.units.flatMap((u) => u.lessons.map((l) => ({ ...l, level: lvl.level }))))
  .sort((a, b) => b.level - a.level || a.order - b.order);

function formsOf(v: VocabInv): string[] {
  return v.reading && v.reading !== v.surface ? [v.surface, v.reading] : [v.surface];
}

/**
 * Lexique cumulé des leçons 0..idx, les leçons RÉCENTES d'abord : la liste envoyée au
 * Worker est tronquée, autant qu'elle garde les mots que l'apprenant vient de voir.
 */
function cumulativeForms(idx: number): string[] {
  const byId = new Map(vocabAll.map((v) => [v.id, v]));
  const out = new Set<string>();
  for (let i = idx; i >= 0; i--) {
    for (const id of lessonsOrdered[i].introduces.vocab) {
      const v = byId.get(id);
      if (v) for (const f of formsOf(v)) out.add(f);
    }
  }
  return [...out];
}

/** Lexique des niveaux déjà enseignés (N5..niveau du point), toléré à la validation. */
function levelLexicon(level: number): Set<string> {
  return new Set(vocabAll.filter((v) => v.level >= level).flatMap(formsOf));
}

// ---- Lots : par leçon, par 10 points ------------------------------------------

interface Batch {
  points: GrammarInv[];
  level: number;
  allowed: string[];
  lexicon: Set<string>;
  label: string;
}

function buildBatches(level?: number, limit?: number): Batch[] {
  const byId = new Map(grammarAll.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const batches: Batch[] = [];
  let budget = limit ?? Infinity;
  lessonsOrdered.forEach((lesson, idx) => {
    if (level && lesson.level !== level) return;
    const points = lesson.introduces.grammar
      .filter((id) => !seen.has(id) && seen.add(id))
      .map((id) => byId.get(id))
      .filter((g): g is GrammarInv => !!g);
    if (!points.length || budget <= 0) return;
    const allowed = cumulativeForms(idx);
    const lexicon = new Set([...allowed, ...levelLexicon(lesson.level)]);
    const taken = points.slice(0, budget);
    budget -= taken.length;
    for (let i = 0; i < taken.length; i += BATCH) {
      batches.push({
        points: taken.slice(i, i + BATCH),
        level: lesson.level,
        allowed,
        lexicon,
        label: `leçon ${lesson.id}`,
      });
    }
  });
  return batches;
}

// ---- Génération (Worker) ------------------------------------------------------

async function generate(batch: Batch, refresh: boolean): Promise<Map<string, Sentence[]>> {
  const body = {
    kind: "grammar-examples",
    level: batch.level,
    grammarPoints: batch.points.map((g) => ({ form: grammarForm(g.name), name: g.name, rule: g.ruleFr })),
    allowedVocab: batch.allowed.slice(0, ALLOWED_MAX),
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
  // Plusieurs lignes par point : « N. phrase japonaise || traduction française », N = n° du point.
  const out = new Map<string, Sentence[]>();
  for (const line of data.text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s*[.．]\s*(.+?)\s*\|\|\s*(.+?)\s*$/);
    if (!m) continue;
    const point = batch.points[Number(m[1]) - 1];
    if (point) out.set(point.id, [...(out.get(point.id) ?? []), { ja: m[2], fr: m[3] }]);
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
const FUNCTION_POS = new Set(["助詞", "助動詞"]);

/**
 * La phrase montre-t-elle la forme du point ? La forme peut proposer des variantes
 * (« これ/それ/あれ », « 〜ていく／〜てくる ») : une suffit. Dans une variante, chaque
 * fragment en kana doit apparaître — comme particule ou auxiliaire s'il tient en un seul
 * kana (で de moyen, pas le で de です) ; sinon au DÉBUT d'un token, dans la phrase telle
 * qu'écrite ou dans la suite de ses formes de base (降ってきた → 降る・て・くる・た montre
 * 〜てくる ; 読んでいる montre 〜ている).
 * Une forme décrite en français (« adjectif -い », « て-forme ») ne se cherche pas : le
 * lexique seul est vérifié, le prompt portant la règle.
 */
/** Un fragment et sa variante sonorisée après un verbe en -ぬ/-む/-ぶ/-ぐ : 読んでいる, 読んだら. */
function voiced(r: string): string[] {
  const head = { て: "で", た: "だ" }[r[0]];
  return head ? [r, head + r.slice(1)] : [r];
}

function showsForm(form: string, tokens: Token[]): boolean {
  const variants = form.split(/[/／]/).map((v) => v.trim()).filter(Boolean);
  if (variants.some((v) => /[A-Za-zÀ-ÿ]/.test(v))) return true;
  const surfaces = tokens.map((t) => t.surface_form);
  const lemmas = tokens.map((t) => (t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form));
  const startsAtToken = (parts: string[], r: string) =>
    parts.some((_, i) => parts.slice(i).join("").startsWith(r));
  return variants.some((v) => {
    const runs = v.match(/[ぁ-ゖー]+/g);
    if (!runs) return false;
    return runs.every((r) =>
      r.length >= 2
        ? voiced(r).some((x) => startsAtToken(surfaces, x) || startsAtToken(lemmas, x))
        : tokens.some((t) => t.surface_form === r && FUNCTION_POS.has(t.pos)),
    );
  });
}

/** null si conforme, sinon la raison du rejet. */
function validate(tk: Tokenizer, point: GrammarInv, lexicon: Set<string>, ja: string): string | null {
  if (ja.length > MAX_LEN) return `trop longue (${ja.length} caractères)`;
  const tokens = tk.tokenize(ja);
  const form = grammarForm(point.name);
  if (!showsForm(form, tokens)) return `forme « ${form} » absente`;
  const offenders: string[] = [];
  for (const t of tokens) {
    if (!CONTENT_POS.has(t.pos) || TOLERATED_DETAIL.has(t.pos_detail_1)) continue;
    const candidates = [t.surface_form, t.basic_form].filter((s) => s && s !== "*");
    if (!candidates.some((c) => lexicon.has(c) || form.includes(c))) offenders.push(t.surface_form);
  }
  return offenders.length ? `hors lexique : ${offenders.join("、")}` : null;
}

// ---- Main ---------------------------------------------------------------------

interface Args { level?: number; limit?: number; refresh: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { refresh: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--level") a.level = Number(argv[++i]) || undefined;
    else if (argv[i] === "--limit") a.limit = Number(argv[++i]) || undefined;
    else if (argv[i] === "--refresh") a.refresh = true;
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const batches = buildBatches(args.level, args.limit);
  const total = batches.reduce((s, b) => s + b.points.length, 0);
  console.log(`Worker : ${WORKER_URL}`);
  console.log(
    `Points : ${total} en ${batches.length} lots${args.level ? ` (N${args.level})` : ""}${args.refresh ? " (refresh)" : ""}`,
  );

  console.log("Chargement du dictionnaire kuromoji…");
  const tk = await buildTokenizer();

  const existing: Record<string, Sentence[]> = existsSync(OUT) ? read(OUT) : {};
  const results: Record<string, Sentence[]> = { ...existing };
  let full = 0;
  let partial = 0;
  let empty = 0;
  let failed = 0;

  for (const batch of batches) {
    const kept = new Map<string, Sentence[]>(batch.points.map((g) => [g.id, []]));
    // Une phrase déjà portée par le point (son exemple du référentiel) n'est pas un doublon utile.
    const seen = new Set(batch.points.map((g) => g.exampleJa).filter((s): s is string => !!s));
    let pending = batch.points;
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      let generated: Map<string, Sentence[]>;
      try {
        // 2ᵉ tentative : refresh forcé, sinon le cache R2 resservirait les mêmes phrases.
        generated = await generate({ ...batch, points: pending }, args.refresh || attempt > 0);
      } catch (e) {
        failed += pending.length;
        console.warn(`✗ ${batch.label} — ${String(e)}`);
        break;
      }
      for (const g of pending) {
        const list = kept.get(g.id)!;
        for (const s of generated.get(g.id) ?? []) {
          if (list.length >= KEEP || seen.has(s.ja)) continue;
          const reason = validate(tk, g, batch.lexicon, s.ja);
          if (reason) {
            if (attempt === 1) console.warn(`  ⚠ ${g.name} (${g.id}) — ${reason} — « ${s.ja} »`);
            continue;
          }
          seen.add(s.ja);
          list.push(s);
        }
      }
      pending = pending.filter((g) => kept.get(g.id)!.length < KEEP);
    }
    for (const [id, list] of kept) {
      // Un point sans aucune phrase conforme garde ce qu'il avait (relance ratée ≠ perte).
      if (list.length) results[id] = list;
      if (list.length >= KEEP) full++;
      else if (list.length) partial++;
      else empty++;
    }
    console.log(`• ${batch.label} — ${batch.points.length} points`);
  }

  writeFileSync(OUT, JSON.stringify(results, null, 1) + "\n");
  console.log(`\nTerminé — ${full} points complets, ${partial} partiels, ${empty} sans phrase, ${failed} échecs réseau.`);
  console.log(`Corpus : ${Object.keys(results).length} points → ${OUT}`);
  if (full + partial === 0 && Object.keys(results).length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
