// Référentiel (inventaire) JLPT : kanji, vocabulaire, grammaire — source unique de vérité.
// Produit par `npm run data:inventory` (kanji/vocab) + curation manuelle (grammar.json).
// Ce module résout les identifiants `introduces` du curriculum en objets affichables par l'UI.

import kanjiInv from "../data/inventory/kanji.json";
import vocabInv from "../data/inventory/vocab.json";
import grammarInv from "../data/inventory/grammar.json";
import vocabFrOverlay from "../data/inventory/vocab-fr.json";
import examplesInv from "../data/inventory/examples.json";
import { kataToHira, splitEntryForms } from "./kana";
import type { VocabEntry } from "./curriculum";

interface KanjiInvEntry {
  id: string;
  level: number;
  fr?: string;
  meanings: string[];
  on?: string[];
  kun?: string[];
  strokes?: number;
}
interface VocabInvEntry {
  id: string;
  level: number;
  surface: string;
  reading: string;
  fr?: string;
  meanings: string[];
}
interface GrammarInvEntry {
  id: string;
  level: number;
  name: string;
  ruleFr: string;
  exampleJa: string;
  exampleFr?: string;
  requires?: string[];
}

const kanjiById = new Map((kanjiInv as KanjiInvEntry[]).map((k) => [k.id, k]));
const vocabById = new Map((vocabInv as VocabInvEntry[]).map((v) => [v.id, v]));
const grammarById = new Map(
  (grammarInv as { items: GrammarInvEntry[] }).items.map((g) => [g.id, g]),
);
const vocabFr = vocabFrOverlay as Record<string, string>;
const examplesById = examplesInv as Record<string, { ja: string; fr?: string }>;

/**
 * Index secondaire : id « propre » d'un token (`basic_form|lecture`, une seule forme)
 * → id canonique de l'inventaire, quand celui-ci regroupe plusieurs formes sous une clé
 * composée (« いい; よい|いい; よい »). Le tokenizer ne produit jamais la forme composée ;
 * sans cet alias, sa définition/son exemple/sa fiche restent introuvables.
 * On développe surface × lecture : la surface garde sa casse (kanji/katakana, pour
 * matcher `basic_form`), la lecture est ramenée en hiragana (comme `itemIdFor`).
 * Les vraies entrées (et le premier alias) gagnent : on n'écrase jamais un id existant.
 */
const vocabAlias = ((): Map<string, string> => {
  const alias = new Map<string, string>();
  for (const v of vocabInv as VocabInvEntry[]) {
    const [surfacePart, readingPart] = v.id.split("|");
    const surfaces = splitEntryForms(surfacePart);
    const readings = splitEntryForms(readingPart).map(kataToHira);
    for (const s of surfaces) {
      for (const r of readings) {
        const key = `${s}|${r}`;
        if (key !== v.id && !vocabById.has(key) && !alias.has(key)) {
          alias.set(key, v.id);
        }
      }
    }
  }
  return alias;
})();

/**
 * Ramène un id de token (forme unique) vers l'id canonique de l'inventaire lorsque
 * celui-ci regroupe plusieurs formes (« いい|いい » → « いい; よい|いい; よい »). Sans effet
 * pour un id déjà canonique ou inconnu (renvoyé tel quel).
 */
export function canonicalVocabId(id: string): string {
  if (vocabById.has(id)) return id;
  return vocabAlias.get(id) ?? id;
}

/**
 * Phrase d'exemple du corpus statique (scripts/build-examples.ts) pour un id de
 * vocabulaire, ou null. Fallback quand le mot n'a pas encore d'exemple issu d'une
 * histoire lue (voir effectiveExample, lib/vocab.ts).
 */
export function staticExample(id: string): { ja: string; fr?: string } | null {
  return examplesById[canonicalVocabId(id)] ?? null;
}

/** Résout un id de vocabulaire `surface|reading` en entrée affichable. */
export function resolveVocab(id: string): VocabEntry {
  const cid = canonicalVocabId(id);
  const v = vocabById.get(cid);
  if (v) {
    return {
      ja: v.surface,
      yomi: v.reading && v.reading !== v.surface ? v.reading : undefined,
      fr: v.fr ?? vocabFr[cid] ?? v.meanings[0] ?? "",
    };
  }
  // Mot non présent dans le pool N5 (ex. composé non listé) : on dérive de l'id.
  const [surface, reading] = cid.split("|");
  return {
    ja: surface,
    yomi: reading && reading !== surface ? reading : undefined,
    fr: vocabFr[cid] ?? "",
  };
}

// ---- Détail d'un kanji (fiche kanji, décomposition d'un mot) ---------------

export interface KanjiDetail {
  /** Le caractère lui-même (= id dans kanji.json). */
  id: string;
  ja: string;
  fr: string;
  meanings: string[];
  on: string[];
  kun: string[];
  strokes?: number;
  level: number;
}

/** Détail d'un kanji de l'inventaire (KANJIDIC), ou null s'il n'y figure pas. */
export function kanjiDetail(ch: string): KanjiDetail | null {
  const k = kanjiById.get(ch);
  if (!k) return null;
  return {
    id: k.id,
    ja: k.id,
    fr: k.fr ?? k.meanings[0] ?? k.id,
    meanings: k.meanings,
    on: k.on ?? [],
    kun: k.kun ?? [],
    strokes: k.strokes,
    level: k.level,
  };
}

/** Résout un id de grammaire en libellé « nom — règle » pour l'UI. */
export function resolveGrammar(id: string): string {
  const g = grammarById.get(id);
  return g ? `${g.name} — ${g.ruleFr}` : id;
}

// ---- Détails structurés pour assembler le cours d'une leçon (UI) ----

export interface GrammarDetail {
  id: string;
  name: string;
  ruleFr: string;
  exampleJa: string;
  exampleFr?: string;
}

/** Détail d'un point de grammaire (règle + exemple) pour le cours, ou null. */
export function grammarDetail(id: string): GrammarDetail | null {
  const g = grammarById.get(id);
  if (!g) return null;
  return { id, name: g.name, ruleFr: g.ruleFr, exampleJa: g.exampleJa, exampleFr: g.exampleFr };
}

// ---- Inventaire complet (catalogue navigable) ------------------------------
// Listes plates de tout le référentiel, triées par niveau (N5 → N1), pour le
// Catalogue. L'UI les joint au statut local (IndexedDB) pour afficher l'avancement.

export interface InvKanji {
  /** = identifiant du store `kanji` en base (le caractère lui-même). */
  id: string;
  ja: string;
  fr: string;
  on: string[];
  kun: string[];
  level: number;
}
export interface InvVocab {
  /** = identifiant `surface|reading` (clé du store `vocab`). */
  id: string;
  ja: string;
  yomi?: string;
  fr: string;
  level: number;
}
export interface InvGrammar {
  /** = identifiant du store `grammar` en base. */
  id: string;
  name: string;
  ruleFr: string;
  exampleJa: string;
  level: number;
}

const byLevelThen = <T extends { level: number }>(key: (x: T) => string) =>
  (a: T, b: T): number => (a.level !== b.level ? b.level - a.level : key(a).localeCompare(key(b)));

export function allKanjiInv(): InvKanji[] {
  return [...kanjiById.values()]
    .map((k) => ({
      id: k.id,
      ja: k.id,
      fr: k.fr ?? k.meanings[0] ?? k.id,
      on: k.on ?? [],
      kun: k.kun ?? [],
      level: k.level,
    }))
    .sort(byLevelThen((x) => x.ja));
}

export function allVocabInv(): InvVocab[] {
  return [...vocabById.values()]
    .map((v) => ({
      id: v.id,
      ja: v.surface,
      yomi: v.reading && v.reading !== v.surface ? v.reading : undefined,
      fr: v.fr ?? vocabFr[v.id] ?? v.meanings[0] ?? "",
      level: v.level,
    }))
    .sort(byLevelThen((x) => x.ja));
}

export function allGrammarInv(): InvGrammar[] {
  return [...grammarById.values()]
    .map((g) => ({ id: g.id, name: g.name, ruleFr: g.ruleFr, exampleJa: g.exampleJa, level: g.level }))
    .sort(byLevelThen((x) => x.name));
}
