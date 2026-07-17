// Parseurs PURS des réponses LLM (robustes au bruit du modèle) : traduction d'histoire
// alignée phrase par phrase, QCM de compréhension. Le transport (fetch vers le Worker)
// vit dans lib/genClient.ts ; ici uniquement du texte → structures, testable en Node.

import { shuffleTracking } from "./random";

export interface StoryTranslation {
  titleFr: string;
  /** Une traduction par phrase JP, dans le même ordre (longueur = jaSentences.length). */
  sentences: string[];
}

/** Moyens mnémotechniques (kanji ou mot) sur trois axes. Pour un mot, `form` = composition. */
export interface Mnemonic {
  reading: string;
  meaning: string;
  form: string;
}

/**
 * Extrait un LOT de mnémotechniques d'une réponse « N. lecture || sens || forme » (une ligne
 * par élément, cf. buildMnemonicPrompt / buildWordMnemonicPrompt côté Worker). Renvoie un
 * tableau de longueur `n`, aligné sur l'ordre demandé ; case null si la ligne manque ou est
 * vide (on préfère un trou à une donnée douteuse). Robuste au bruit : ignore les lignes non
 * numérotées, tolère un 4ᵉ champ surnuméraire (rattaché à la forme).
 */
export function parseMnemonicBatch(raw: string, n: number): (Mnemonic | null)[] {
  const out: (Mnemonic | null)[] = new Array(n).fill(null);
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*[.．)]\s*(.+)$/);
    if (!m) continue;
    const idx = Number(m[1]) - 1;
    if (idx < 0 || idx >= n || out[idx]) continue;
    const parts = m[2].split("||").map((s) => s.trim());
    const reading = parts[0] ?? "";
    const meaning = parts[1] ?? "";
    const form = parts.slice(2).join(" ").trim(); // 3ᵉ champ (+ surplus éventuel)
    if (!reading && !meaning && !form) continue;
    out[idx] = { reading, meaning, form };
  }
  return out;
}

/** Extrait le titre et les N traductions du texte renvoyé par le modèle (robuste au bruit). */
export function parseStoryTranslation(raw: string, n: number): StoryTranslation {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let titleFr = "";
  const numbered: string[] = new Array(n).fill("");
  const others: string[] = [];
  for (const line of lines) {
    const t = line.match(/^TITRE\s*[:：]\s*(.+)$/i);
    if (t) {
      titleFr = titleFr || t[1].trim();
      continue;
    }
    const m = line.match(/^\[?(\d+)\]?[.)、．]\s*(.+)$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < n && !numbered[idx]) numbered[idx] = m[2].trim();
      else others.push(line);
    } else {
      others.push(line);
    }
  }

  // Repli : si la numérotation n'a pas rempli toutes les phrases, on complète dans l'ordre
  // avec les lignes restantes (hors titre).
  let oi = 0;
  for (let i = 0; i < n; i++) {
    if (!numbered[i] && oi < others.length) numbered[i] = others[oi++];
  }
  if (!titleFr) titleFr = others[oi] ?? "Histoire";
  return { titleFr, sentences: numbered };
}

export interface ComprehensionQuestion {
  /** Énoncé en français. */
  question: string;
  /** Propositions en français, déjà mélangées. */
  options: string[];
  /** Index de la bonne proposition dans `options`. */
  answerIndex: number;
  /** Point de grammaire testé (résolu depuis le tag [Gk]) ; absent si compréhension générale. */
  targetGrammarId?: string;
}

/**
 * Extrait les questions du QCM renvoyé par le modèle (robuste au bruit). Une ligne
 * « N. [Gk] énoncé » ouvre une question ; les lignes « + … » / « - … » sont ses
 * propositions (« + » = bonne réponse). `grammarIds` (ordonné) résout le tag [Gk] → id
 * (k=0 ou absent ⇒ pas de point précis). Les questions sans bonne réponse ou avec moins
 * de deux propositions sont ignorées.
 */
export function parseComprehensionQcm(
  raw: string,
  grammarIds: string[] = [],
): ComprehensionQuestion[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  interface Draft {
    question: string;
    targetGrammarId?: string;
    options: string[];
    correct: number;
  }
  const drafts: Draft[] = [];
  let cur: Draft | null = null;

  for (const line of lines) {
    const q = line.match(/^\[?(\d+)\]?(?:[.)、．]|\s)\s*(?:\[\s*[Gg]\s*(\d+)\s*\]\s*)?(.+)$/);
    if (q) {
      cur = { question: q[3].trim(), options: [], correct: -1 };
      const gk = q[2] ? Number(q[2]) : 0;
      if (gk >= 1 && gk <= grammarIds.length) cur.targetGrammarId = grammarIds[gk - 1];
      drafts.push(cur);
      continue;
    }
    const o = line.match(/^([+\-*•])\s*(.+)$/);
    if (o && cur) {
      const good = o[1] === "+" || o[1] === "*";
      if (good && cur.correct < 0) cur.correct = cur.options.length;
      cur.options.push(o[2].trim());
    }
  }

  const out: ComprehensionQuestion[] = [];
  for (const d of drafts) {
    if (d.options.length < 2 || d.correct < 0) continue;
    const { items, index } = shuffleTracking(d.options, d.correct);
    out.push({
      question: d.question,
      options: items,
      answerIndex: index,
      targetGrammarId: d.targetGrammarId,
    });
  }
  return out;
}
