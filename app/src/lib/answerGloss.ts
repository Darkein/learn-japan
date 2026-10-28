// Sens de la réponse FAUSSE : quand on se trompe, savoir ce qu'on a choisi ou tapé
// (« ねこ ? c'est « chat », pas « chien » ») transforme l'erreur en apprentissage. La
// correction le montre si le mot existe — QCM comme saisie, en kana comme en kanji.

import { allVocab } from "./db";
import { loadContentDict } from "./data";
import type { ContentDict } from "./gloss";
import { allVocabInv } from "./inventory";
import { hasJapanese, kataToHira, normalizeReading, splitEntryForms } from "./kana";

/** Ce que veut dire la réponse donnée : en japonais, son sens ; en français, son mot. */
export interface AnswerGloss {
  /** Graphie du mot (kanji le cas échéant). */
  ja: string;
  /** Lecture, quand elle diffère de la graphie. */
  reading?: string;
  fr: string;
}

/** Un mot connu de l'apprenant ou du référentiel, réduit à ce que la recherche consulte. */
export interface GlossWord {
  surface: string;
  reading: string;
  fr: string;
}

export interface GlossSources {
  /** Mots de l'apprenant (base locale) PUIS du référentiel : le premier qui matche gagne. */
  words: GlossWord[];
  /** JMdict-FR (forme → sens), repli pour les mots hors des deux listes. */
  dict: ContentDict;
  /** Forme de dictionnaire d'une forme conjuguée (食べた → 食べる), ou null. */
  baseForm?: (text: string) => Promise<string | null>;
}

const isGloss = (fr: string | undefined): fr is string => !!fr && fr !== "—";

/** Formes sous lesquelles un mot peut être saisi : chaque graphie et chaque lecture. */
function formsOf(w: GlossWord): string[] {
  return [...splitEntryForms(w.surface), ...splitEntryForms(w.reading)];
}

function toGloss(w: GlossWord): AnswerGloss {
  const ja = splitEntryForms(w.surface)[0] ?? w.surface;
  const reading = splitEntryForms(w.reading)[0];
  return { ja, reading: reading && reading !== ja ? reading : undefined, fr: w.fr };
}

/**
 * Sens d'une réponse japonaise : mot de l'apprenant ou du référentiel d'abord (sens curé,
 * homophones départagés), JMdict ensuite, puis la forme de dictionnaire si la réponse est
 * conjuguée. Comparaison en hiragana : ネコ tapé vaut ねこ.
 */
async function glossJapanese(text: string, src: GlossSources, depth = 0): Promise<AnswerGloss | null> {
  const key = normalizeReading(text);
  const hit = src.words.find(
    (w) => isGloss(w.fr) && formsOf(w).some((f) => f === text || normalizeReading(f) === key),
  );
  if (hit) return toGloss(hit);
  for (const form of new Set([text, kataToHira(text)])) {
    const fr = src.dict[form];
    if (isGloss(fr)) return { ja: text, fr };
  }
  if (depth === 0 && src.baseForm) {
    const base = await src.baseForm(text);
    if (base && base !== text) return glossJapanese(base, src, 1);
  }
  return null;
}

/** Mot désigné par un sens français (QCM « quel sens ? ») — comparaison exacte. */
function glossFrench(text: string, src: GlossSources): AnswerGloss | null {
  const t = text.trim();
  const hit = src.words.find((w) => w.fr.trim() === t);
  return hit ? { ...toGloss(hit), fr: t } : null;
}

/** Sens d'une réponse (japonaise ou française), ou null si on ne la connaît pas. */
export async function glossAnswer(text: string, src: GlossSources): Promise<AnswerGloss | null> {
  const t = text.trim();
  if (!t) return null;
  return hasJapanese(t) ? glossJapanese(t, src) : glossFrench(t, src);
}

/**
 * Forme de dictionnaire d'une réponse conjuguée, si kuromoji y lit UN seul mot plein
 * (suivi d'auxiliaires) : 食べた → 食べる. Hors de ce cas, on ne devine pas.
 */
async function kuromojiBaseForm(text: string): Promise<string | null> {
  const { tokenize } = await import("./tokenizer");
  const tokens = await tokenize(text);
  const content = tokens.filter((t) => t.pos !== "助動詞" && t.pos !== "助詞");
  if (content.length !== 1) return null;
  const base = content[0].basic_form;
  return base && base !== "*" ? base : null;
}

/** Sources réelles : base locale, référentiel, JMdict-FR, kuromoji. Tout est best-effort. */
async function liveSources(): Promise<GlossSources> {
  const [mine, dict] = await Promise.all([
    allVocab().catch(() => []),
    loadContentDict().catch(() => ({}) as ContentDict),
  ]);
  const inv = allVocabInv().map((v) => ({ surface: v.ja, reading: v.yomi ?? v.ja, fr: v.fr }));
  return {
    words: [...mine.map((v) => ({ surface: v.surface, reading: v.reading, fr: v.meaning })), ...inv],
    dict,
    baseForm: (t) => kuromojiBaseForm(t).catch(() => null),
  };
}

/** `glossAnswer` sur les sources réelles. Ne lève jamais : null en cas d'échec. */
export async function lookupAnswerGloss(text: string): Promise<AnswerGloss | null> {
  try {
    return await glossAnswer(text, await liveSources());
  } catch {
    return null;
  }
}
