// Vérificateur de cohérence du curriculum — remplace le jugement humain (l'utilisateur
// n'a pas besoin de lire le japonais). Lancé en local (`npm run curriculum:check`) et en CI.
//
// Contrôles :
//  1. Couverture kanji   — chaque kanji N5 de l'inventaire est introduit par EXACTEMENT une leçon.
//  2. Couverture grammaire — chaque point de grammaire de l'inventaire est introduit exactement une fois.
//  3. Intégrité des refs — tout id `introduces` (kanji/grammaire) existe dans l'inventaire ;
//                          les vocab inconnus sont signalés (avertissement).
//  4. Prérequis grammaire — un prérequis est introduit dans une leçon d'ordre <= celle qui en dépend.
//  5. Référence en avant — une histoire (seed) n'emploie pas un kanji introduit PLUS TARD.
//
// Les manquements 1–4 sont des ERREURS (exit 1). Le 5 et les vocab inconnus sont des AVERTISSEMENTS.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "app", "src", "data");
const INV = join(DATA, "inventory");

const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

interface Introduces {
  vocab: string[];
  kanji: string[];
  grammar: string[];
}
interface LessonNode {
  id: string;
  order: number;
  title: string;
  introduces: Introduces;
  seed?: { intro: string; storyJa: string };
}
interface UnitNode {
  id: string;
  title: string;
  lessons: LessonNode[];
}
interface LevelNode {
  level: number;
  units: UnitNode[];
}
interface CurriculumV3 {
  version: number;
  levels: LevelNode[];
}

interface KanjiInv {
  id: string;
  level: number;
}
interface VocabInv {
  id: string;
}
interface GrammarInv {
  items: { id: string; level: number; requires?: string[] }[];
}

const curriculum = read<CurriculumV3>(join(DATA, "curriculum.json"));
const kanjiInv = read<KanjiInv[]>(join(INV, "kanji.json"));
const vocabInv = read<VocabInv[]>(join(INV, "vocab.json"));
const grammarInv = read<GrammarInv>(join(INV, "grammar.json"));
const vocabFr = read<Record<string, string>>(join(INV, "vocab-fr.json"));

const errors: string[] = [];
const warnings: string[] = [];

// Aplatissement : leçons d'un niveau donné, triées par ordre.
function lessonsOfLevel(level: number): LessonNode[] {
  const lvl = curriculum.levels.find((l) => l.level === level);
  if (!lvl) return [];
  return lvl.units
    .flatMap((u) => u.lessons)
    .slice()
    .sort((a, b) => a.order - b.order);
}

const N5 = 5;
const lessons = lessonsOfLevel(N5);

// Index inventaire
const kanjiById = new Map(kanjiInv.map((k) => [k.id, k]));
const n5Kanji = new Set(kanjiInv.filter((k) => k.level === N5).map((k) => k.id));
const vocabIds = new Set(vocabInv.map((v) => v.id));
const grammarById = new Map(grammarInv.items.map((g) => [g.id, g]));

// --- 1 & 2 & 3 : couverture + intégrité ---
const kanjiIntro = new Map<string, string[]>(); // kanji → leçons qui l'introduisent
const grammarIntro = new Map<string, string[]>();
const orderOfGrammar = new Map<string, number>();

for (const l of lessons) {
  for (const k of l.introduces.kanji) {
    if (!kanjiById.has(k)) errors.push(`[ref] leçon ${l.id} : kanji « ${k} » absent de l'inventaire`);
    (kanjiIntro.get(k) ?? kanjiIntro.set(k, []).get(k)!).push(l.id);
  }
  for (const g of l.introduces.grammar) {
    if (!grammarById.has(g)) errors.push(`[ref] leçon ${l.id} : grammaire « ${g} » absente de l'inventaire`);
    (grammarIntro.get(g) ?? grammarIntro.set(g, []).get(g)!).push(l.id);
    orderOfGrammar.set(g, l.order);
  }
  for (const v of l.introduces.vocab) {
    if (!vocabIds.has(v) && !(v in vocabFr))
      warnings.push(`[vocab] leçon ${l.id} : « ${v} » ni dans vocab.json ni dans l'overlay FR (repli sur l'id)`);
  }
}

// Couverture kanji N5
for (const k of n5Kanji) {
  const hits = kanjiIntro.get(k) ?? [];
  if (hits.length === 0) errors.push(`[couverture] kanji N5 « ${k} » n'est introduit par aucune leçon`);
  else if (hits.length > 1) errors.push(`[couverture] kanji N5 « ${k} » introduit par ${hits.length} leçons : ${hits.join(", ")}`);
}
// Kanji introduits qui ne sont pas N5 (hors-niveau, toléré mais signalé)
for (const [k, hits] of kanjiIntro) {
  if (!n5Kanji.has(k) && kanjiById.has(k))
    warnings.push(`[hors-niveau] kanji « ${k} » (N${kanjiById.get(k)!.level}) introduit en N5 par ${hits.join(", ")}`);
}

// Couverture grammaire (tous les items de l'inventaire)
for (const g of grammarById.keys()) {
  const hits = grammarIntro.get(g) ?? [];
  if (hits.length === 0) errors.push(`[couverture] grammaire « ${g} » n'est introduite par aucune leçon`);
  else if (hits.length > 1) errors.push(`[couverture] grammaire « ${g} » introduite par ${hits.length} leçons : ${hits.join(", ")}`);
}

// --- 4 : prérequis grammaire ---
for (const g of grammarInv.items) {
  const ord = orderOfGrammar.get(g.id);
  if (ord == null) continue;
  for (const req of g.requires ?? []) {
    const reqOrd = orderOfGrammar.get(req);
    if (reqOrd == null) errors.push(`[prérequis] « ${g.id} » exige « ${req} » qui n'est introduit nulle part`);
    else if (reqOrd > ord)
      errors.push(`[prérequis] « ${g.id} » (leçon ordre ${ord}) exige « ${req} » introduit plus tard (ordre ${reqOrd})`);
  }
}

// --- 5 : pas de référence en avant (au niveau kanji) ---
const introducedUpTo = (order: number): Set<string> => {
  const s = new Set<string>();
  for (const l of lessons) if (l.order <= order) for (const k of l.introduces.kanji) s.add(k);
  return s;
};
for (const l of lessons) {
  if (!l.seed?.storyJa) continue;
  const known = introducedUpTo(l.order);
  const story = [...l.seed.storyJa];
  const forward = new Set<string>();
  for (const ch of story) {
    if (!/[一-龯]/.test(ch)) continue; // kanji uniquement
    if (kanjiById.has(ch) && !known.has(ch)) {
      // kanji connu de l'inventaire mais pas encore introduit
      const introLesson = kanjiIntro.get(ch)?.[0];
      if (introLesson) forward.add(`${ch}→${introLesson}`);
    }
  }
  if (forward.size)
    warnings.push(`[avance] ${l.id} emploie des kanji introduits plus tard : ${[...forward].join(", ")}`);
}

// --- Rapport ---
const totalN5 = n5Kanji.size;
const coveredN5 = [...n5Kanji].filter((k) => (kanjiIntro.get(k) ?? []).length === 1).length;
console.log(`Curriculum N5 : ${lessons.length} leçons.`);
console.log(`Kanji N5 couverts : ${coveredN5}/${totalN5}. Grammaire : ${grammarIntro.size}/${grammarById.size}.`);

for (const w of warnings) console.warn("⚠️  " + w);
if (errors.length) {
  for (const e of errors) console.error("❌ " + e);
  console.error(`\n${errors.length} erreur(s) — curriculum incohérent.`);
  process.exit(1);
}
console.log(`\n✅ Cohérence OK${warnings.length ? ` (${warnings.length} avertissement(s))` : ""}.`);
