// Référentiel (inventaire) JLPT : kanji, vocabulaire, grammaire — source unique de vérité.
// Produit par `npm run data:inventory` (kanji/vocab) + curation manuelle (grammar.json).
// Ce module résout les identifiants `introduces` du curriculum en objets affichables par l'UI.

import kanjiInv from "../data/inventory/kanji.json";
import vocabInv from "../data/inventory/vocab.json";
import grammarInv from "../data/inventory/grammar.json";
import vocabFrOverlay from "../data/inventory/vocab-fr.json";
import examplesInv from "../data/inventory/examples.json";
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
 * Phrase d'exemple du corpus statique (scripts/build-examples.ts) pour un id de
 * vocabulaire, ou null. Fallback quand le mot n'a pas encore d'exemple issu d'une
 * histoire lue (voir effectiveExample, lib/vocab.ts).
 */
export function staticExample(id: string): { ja: string; fr?: string } | null {
  return examplesById[id] ?? null;
}

/** Résout un id de vocabulaire `surface|reading` en entrée affichable. */
export function resolveVocab(id: string): VocabEntry {
  const v = vocabById.get(id);
  if (v) {
    return {
      ja: v.surface,
      yomi: v.reading && v.reading !== v.surface ? v.reading : undefined,
      fr: v.fr ?? vocabFr[id] ?? v.meanings[0] ?? "",
    };
  }
  // Mot non présent dans le pool N5 (ex. composé non listé) : on dérive de l'id.
  const [surface, reading] = id.split("|");
  return {
    ja: surface,
    yomi: reading && reading !== surface ? reading : undefined,
    fr: vocabFr[id] ?? "",
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
}

/** Détail d'un point de grammaire (règle + exemple) pour le cours, ou null. */
export function grammarDetail(id: string): GrammarDetail | null {
  const g = grammarById.get(id);
  if (!g) return null;
  return { id, name: g.name, ruleFr: g.ruleFr, exampleJa: g.exampleJa };
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
