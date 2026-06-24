// Référentiel (inventaire) JLPT : kanji, vocabulaire, grammaire — source unique de vérité.
// Produit par `npm run data:inventory` (kanji/vocab) + curation manuelle (grammar.json).
// Ce module résout les identifiants `introduces` du curriculum en objets affichables par l'UI.

import kanjiInv from "../data/inventory/kanji.json";
import vocabInv from "../data/inventory/vocab.json";
import grammarInv from "../data/inventory/grammar.json";
import vocabFrOverlay from "../data/inventory/vocab-fr.json";
import type { KanjiEntry, VocabEntry } from "./lessons";

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

/** Niveau JLPT d'un kanji isolé (5 = N5 … 1 = N1), ou null si hors référentiel. */
export function kanjiLevel(ch: string): number | null {
  return kanjiById.get(ch)?.level ?? null;
}

/** Niveau JLPT d'un mot (par `surface|reading` ou par surface seule), ou null. */
export function vocabLevel(surface: string, reading?: string): number | null {
  if (reading) {
    const exact = vocabById.get(`${surface}|${reading}`);
    if (exact) return exact.level;
  }
  for (const v of vocabById.values()) if (v.surface === surface) return v.level;
  return null;
}

/** Résout un id de kanji (le caractère) en entrée affichable. FR curé sinon repli EN. */
export function resolveKanji(id: string): KanjiEntry {
  const k = kanjiById.get(id);
  return { ja: id, fr: k?.fr ?? k?.meanings[0] ?? id };
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

export interface KanjiDetail {
  ja: string;
  fr: string;
  on: string[];
  kun: string[];
  strokes?: number;
}
export interface GrammarDetail {
  id: string;
  name: string;
  ruleFr: string;
  exampleJa: string;
}

/** Détail d'un kanji (sens FR + lectures) pour le cours, ou null si hors référentiel. */
export function kanjiDetail(id: string): KanjiDetail | null {
  const k = kanjiById.get(id);
  if (!k) return null;
  return {
    ja: id,
    fr: k.fr ?? k.meanings[0] ?? id,
    on: k.on ?? [],
    kun: k.kun ?? [],
    strokes: k.strokes,
  };
}

/** Détail d'un point de grammaire (règle + exemple) pour le cours, ou null. */
export function grammarDetail(id: string): GrammarDetail | null {
  const g = grammarById.get(id);
  if (!g) return null;
  return { id, name: g.name, ruleFr: g.ruleFr, exampleJa: g.exampleJa };
}
