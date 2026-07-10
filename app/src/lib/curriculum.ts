// Curriculum statique (curriculum.json) : niveau → unité → leçon, avec références à
// l'inventaire (`introduces`) résolues en objectifs affichables. Aucun accès IndexedDB ni
// réseau ici — l'hydratation (progression, maîtrise, génération) vit dans lib/lessons.ts.

import curriculumData from "../data/curriculum.json";
import { resolveGrammar, resolveVocab } from "./inventory";

export interface VocabEntry {
  ja: string;
  /** Lecture en hiragana (absente si `ja` est déjà entièrement en kana). */
  yomi?: string;
  fr: string;
}

export interface LessonObjectives {
  vocab: VocabEntry[];
  grammar: string[];
}

export interface CurriculumEntry {
  id: string;
  order: number;
  /** Révision du contenu (curriculum.json, défaut 1) : invalide les cadrages générés pour d'anciens objectifs. */
  rev: number;
  level: number;
  title: string;
  summary?: string;
  /** Unité (chunk) à laquelle appartient la leçon. */
  unitId?: string;
  unitTitle?: string;
  objectives: LessonObjectives;
  /** Identifiants bruts vers l'inventaire (pour assembler le cours structuré). */
  introduces: Introduces;
}

// ---- Curriculum v3 : niveau → unité → leçon, avec références à l'inventaire ----

export interface Introduces {
  vocab: string[];
  grammar: string[];
}
interface RawLesson {
  id: string;
  order: number;
  rev?: number;
  title: string;
  summary?: string;
  introduces: Introduces;
}
interface RawUnit {
  id: string;
  title: string;
  lessons: RawLesson[];
}
interface RawLevel {
  level: number;
  units: RawUnit[];
}
interface CurriculumFileV3 {
  version: number;
  levels: RawLevel[];
}

/** Résout les identifiants `introduces` en objectifs affichables via l'inventaire. */
function resolveObjectives(intro: Introduces): LessonObjectives {
  return {
    vocab: intro.vocab.map(resolveVocab),
    grammar: intro.grammar.map(resolveGrammar),
  };
}

/** Ordre pédagogique : niveau JLPT décroissant (N5 d'abord), puis ordre dans le niveau. */
function byLevelThenOrder(a: CurriculumEntry, b: CurriculumEntry): number {
  return a.level !== b.level ? b.level - a.level : a.order - b.order;
}

const CURRICULUM: CurriculumEntry[] = (curriculumData as CurriculumFileV3).levels
  .flatMap((lvl) =>
    lvl.units.flatMap((unit) =>
      unit.lessons.map(
        (l): CurriculumEntry => ({
          id: l.id,
          order: l.order,
          rev: l.rev ?? 1,
          level: lvl.level,
          title: l.title,
          summary: l.summary,
          unitId: unit.id,
          unitTitle: unit.title,
          objectives: resolveObjectives(l.introduces),
          introduces: l.introduces,
        }),
      ),
    ),
  )
  .sort(byLevelThenOrder);

export function getCurriculum(): CurriculumEntry[] {
  return CURRICULUM;
}

export function getCurriculumEntry(id: string): CurriculumEntry | undefined {
  return CURRICULUM.find((c) => c.id === id);
}

/**
 * Leçons adjacentes dans l'ordre pédagogique (voisinage pour la navigation par swipe /
 * flèches). Le verrou d'unlock est volontairement ignoré : la navigation adjacente est une
 * action délibérée. Renvoie `undefined` aux extrémités (première / dernière leçon).
 */
export function lessonNeighbors(id: string): { prevId?: string; nextId?: string } {
  const i = CURRICULUM.findIndex((c) => c.id === id);
  if (i === -1) return {};
  return {
    prevId: i > 0 ? CURRICULUM[i - 1].id : undefined,
    nextId: i < CURRICULUM.length - 1 ? CURRICULUM[i + 1].id : undefined,
  };
}

/**
 * Lexique cumulé connu à la leçon `id` : union des objectifs de toutes les leçons
 * déjà vues (niveau supérieur, ou même niveau d'ordre <= celui de la leçon). Sert à
 * contraindre la génération pour qu'une histoire n'emploie que du vocabulaire déjà introduit.
 */
export function getCumulativeObjectives(id: string): LessonObjectives {
  const target = getCurriculumEntry(id);
  if (!target) return { vocab: [], grammar: [] };
  const seen = CURRICULUM.filter(
    (c) => c.level > target.level || (c.level === target.level && c.order <= target.order),
  );
  const vocab = new Map<string, VocabEntry>();
  const grammar = new Set<string>();
  for (const c of seen) {
    for (const v of c.objectives.vocab) vocab.set(v.ja + "|" + (v.yomi ?? ""), v);
    for (const g of c.objectives.grammar) grammar.add(g);
  }
  return { vocab: [...vocab.values()], grammar: [...grammar] };
}

let grammarOrder: Map<string, number> | null = null;

/**
 * Index curriculaire de chaque point de grammaire : position (dans l'ordre pédagogique)
 * de la leçon qui l'introduit. Sert à choisir des distracteurs de QCM proches dans la
 * progression (donc plausibles) plutôt que tirés dans tout l'inventaire.
 */
export function grammarLessonOrder(): Map<string, number> {
  if (!grammarOrder) {
    grammarOrder = new Map();
    CURRICULUM.forEach((c, i) => {
      for (const g of c.introduces.grammar) {
        if (!grammarOrder!.has(g)) grammarOrder!.set(g, i);
      }
    });
  }
  return grammarOrder;
}

/** Leçons qui introduisent au moins une des règles de grammaire données (par id), triées par ordre. */
export function lessonsForGrammar(grammarIds: string[]): CurriculumEntry[] {
  if (grammarIds.length === 0) return [];
  const ids = new Set(grammarIds);
  return CURRICULUM.filter((c) => c.introduces.grammar.some((g) => ids.has(g))).sort(
    byLevelThenOrder,
  );
}
