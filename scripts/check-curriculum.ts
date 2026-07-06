// Vérificateur de cohérence du curriculum — remplace le jugement humain (l'utilisateur
// n'a pas besoin de lire le japonais). Lancé en local (`npm run curriculum:check`) et en CI.
//
// Multi-niveaux : les leçons sont parcourues dans l'ordre pédagogique (N5 → N4 → … → N1).
// Contrôles STRUCTURELS (toujours des erreurs, tous niveaux) :
//  1. Intégrité des refs — tout id `introduces.grammar` existe dans l'inventaire ;
//     les vocab inconnus sont signalés (avertissement).
//  2. Grammaire introduite AU PLUS une fois, et par une leçon de son propre niveau.
//  3. Prérequis grammaire — introduit dans un niveau enseigné plus tôt (numéro plus grand),
//     ou dans le même niveau à un ordre <=.
//  4. Unicité globale des ids de leçons ; `order` par niveau = suite 1..n sans trou ;
//     préfixe d'id conforme au bloc (`n4-…` dans le niveau 4).
//  5. Densité — au plus MAX_NEW_VOCAB mots NOUVEAUX par leçon (avertissement au-delà).
//
// Contrôles de COUVERTURE (exhaustivité de l'inventaire) : erreurs uniquement pour les
// niveaux marqués `"complete": true` dans curriculum.json ; sinon simple rapport (WIP) —
// permet de committer l'inventaire d'un niveau puis d'écrire ses leçons par lots.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "app", "src", "data");
const INV = join(DATA, "inventory");

const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

interface Introduces {
  vocab: string[];
  grammar: string[];
}
interface LessonNode {
  id: string;
  order: number;
  title: string;
  introduces: Introduces;
}
interface UnitNode {
  id: string;
  title: string;
  lessons: LessonNode[];
}
interface LevelNode {
  level: number;
  complete?: boolean;
  units: UnitNode[];
}
interface CurriculumV3 {
  version: number;
  levels: LevelNode[];
}

interface VocabInv {
  id: string;
  level: number;
}
interface GrammarInv {
  items: { id: string; level: number; requires?: string[] }[];
}

const curriculum = read<CurriculumV3>(join(DATA, "curriculum.json"));
const vocabInv = read<VocabInv[]>(join(INV, "vocab.json"));
const grammarInv = read<GrammarInv>(join(INV, "grammar.json"));
const vocabFr = read<Record<string, string>>(join(INV, "vocab-fr.json"));

const errors: string[] = [];
const warnings: string[] = [];

// Niveaux dans l'ordre pédagogique (N5=5 enseigné en premier).
const levels = [...curriculum.levels].sort((a, b) => b.level - a.level);
const completeByLevel = new Map(levels.map((l) => [l.level, l.complete === true]));

function lessonsOfLevel(lvl: LevelNode): LessonNode[] {
  return lvl.units
    .flatMap((u) => u.lessons)
    .slice()
    .sort((a, b) => a.order - b.order);
}

// Index inventaire
const vocabById = new Map(vocabInv.map((v) => [v.id, v]));
const grammarById = new Map(grammarInv.items.map((g) => [g.id, g]));

// --- Parcours global dans l'ordre pédagogique -----------------------------------
// grammarIntro : leçons qui introduisent chaque point ; position = (niveau, ordre).
const grammarIntro = new Map<string, string[]>();
const grammarPos = new Map<string, { level: number; order: number }>();
const firstIntro = new Map<string, string>(); // vocab id → leçon qui l'introduit
const seenLessonIds = new Map<string, string>(); // id → "niveau"
const MAX_NEW_VOCAB = 19;

for (const lvl of levels) {
  const lessons = lessonsOfLevel(lvl);

  // 4. orders 1..n sans trou ni doublon, préfixe d'id conforme.
  lessons.forEach((l, i) => {
    if (l.order !== i + 1)
      errors.push(`[ordre] niveau ${lvl.level} : ordres non contigus autour de « ${l.id} » (attendu ${i + 1}, trouvé ${l.order})`);
    if (!l.id.startsWith(`n${lvl.level}-`))
      errors.push(`[id] leçon « ${l.id} » dans le bloc niveau ${lvl.level} sans préfixe n${lvl.level}-`);
    const dup = seenLessonIds.get(l.id);
    if (dup) errors.push(`[id] leçon « ${l.id} » dupliquée (déjà vue au niveau ${dup})`);
    seenLessonIds.set(l.id, String(lvl.level));
  });

  for (const l of lessons) {
    // 1 & 2 : refs + introductions grammaire.
    for (const g of l.introduces.grammar) {
      const item = grammarById.get(g);
      if (!item) {
        errors.push(`[ref] leçon ${l.id} : grammaire « ${g} » absente de l'inventaire`);
        continue;
      }
      if (item.level !== lvl.level)
        errors.push(`[niveau] leçon ${l.id} (N${lvl.level}) introduit « ${g} » qui est de niveau N${item.level}`);
      (grammarIntro.get(g) ?? grammarIntro.set(g, []).get(g)!).push(l.id);
      grammarPos.set(g, { level: lvl.level, order: l.order });
    }
    // 5 : densité + firstIntro vocab (un mot re-listé plus tard = rappel volontaire).
    let fresh = 0;
    for (const v of l.introduces.vocab) {
      if (!vocabById.has(v) && !(v in vocabFr))
        warnings.push(`[vocab] leçon ${l.id} : « ${v} » ni dans vocab.json ni dans l'overlay FR (repli sur l'id)`);
      if (!firstIntro.has(v)) {
        firstIntro.set(v, l.id);
        fresh += 1;
      }
    }
    if (fresh > MAX_NEW_VOCAB)
      warnings.push(`[densité] leçon ${l.id} : ${fresh} mots nouveaux (> ${MAX_NEW_VOCAB})`);
  }
}

// 2. Grammaire introduite au plus une fois (toujours une erreur).
for (const [g, hits] of grammarIntro) {
  if (hits.length > 1)
    errors.push(`[couverture] grammaire « ${g} » introduite par ${hits.length} leçons : ${hits.join(", ")}`);
}

// 3. Prérequis : niveau enseigné plus tôt (numéro >), ou même niveau à ordre <=.
for (const g of grammarInv.items) {
  const pos = grammarPos.get(g.id);
  if (!pos) continue; // pas encore introduit → géré par la couverture
  const complete = completeByLevel.get(pos.level) ?? false;
  for (const req of g.requires ?? []) {
    const reqPos = grammarPos.get(req);
    if (!reqPos) {
      const msg = `[prérequis] « ${g.id} » exige « ${req} » qui n'est introduit nulle part`;
      if (complete) errors.push(msg);
      else warnings.push(msg + " (niveau WIP)");
    } else if (reqPos.level < pos.level || (reqPos.level === pos.level && reqPos.order > pos.order)) {
      errors.push(
        `[prérequis] « ${g.id} » (N${pos.level}, ordre ${pos.order}) exige « ${req} » introduit plus tard (N${reqPos.level}, ordre ${reqPos.order})`,
      );
    }
  }
}

// --- Couverture par niveau + rapport ---------------------------------------------
for (const lvl of levels) {
  const lessons = lessonsOfLevel(lvl);
  const complete = completeByLevel.get(lvl.level) ?? false;
  const vocabOfLevel = vocabInv.filter((v) => v.level === lvl.level);
  const grammarOfLevel = grammarInv.items.filter((g) => g.level === lvl.level);
  if (lessons.length === 0 && vocabOfLevel.length === 0 && grammarOfLevel.length === 0) continue;

  const coveredVocab = vocabOfLevel.filter((v) => firstIntro.has(v.id));
  const coveredGrammar = grammarOfLevel.filter((g) => grammarIntro.has(g.id));

  if (complete) {
    for (const g of grammarOfLevel) {
      if (!grammarIntro.has(g.id))
        errors.push(`[couverture] grammaire « ${g.id} » (N${lvl.level}) n'est introduite par aucune leçon`);
    }
    for (const v of vocabOfLevel) {
      if (!firstIntro.has(v.id))
        errors.push(`[couverture-vocab] « ${v.id} » (${vocabFr[v.id] ?? "?"}) n'est introduit par aucune leçon`);
    }
  }

  console.log(
    `N${lvl.level}${complete ? "" : " (WIP)"} : ${lessons.length} leçons. ` +
      `Grammaire : ${coveredGrammar.length}/${grammarOfLevel.length}. ` +
      `Vocabulaire : ${coveredVocab.length}/${vocabOfLevel.length}.`,
  );
}

for (const w of warnings) console.warn("⚠️  " + w);
if (errors.length) {
  for (const e of errors) console.error("❌ " + e);
  console.error(`\n${errors.length} erreur(s) — curriculum incohérent.`);
  process.exit(1);
}
console.log(`\n✅ Cohérence OK${warnings.length ? ` (${warnings.length} avertissement(s))` : ""}.`);
