// Génération de furigana DÉTERMINISTE à partir de (surface, reading) d'un token.
// Aligne les lectures sur les seuls kanji (l'okurigana reste en clair).
// Fonctions pures → testables sans charger kuromoji.

import { hasKanji, isKanji, kataToHira } from "./kana";
import type { KuromojiToken } from "./tokenizer";

/** Un segment de rendu : `base` (texte affiché), `ruby` (furigana) optionnel. */
export interface RubySegment {
  base: string;
  ruby?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Découpe une surface en runs alternés kanji / kana(+autres). */
function splitRuns(surface: string): { text: string; kanji: boolean }[] {
  const runs: { text: string; kanji: boolean }[] = [];
  for (const ch of surface) {
    const k = isKanji(ch);
    const last = runs[runs.length - 1];
    if (last && last.kanji === k) last.text += ch;
    else runs.push({ text: ch, kanji: k });
  }
  return runs;
}

/**
 * Aligne `reading` (kana) sur `surface`, en attachant les furigana aux runs de kanji.
 * Retourne des segments prêts à rendre en <ruby>. En cas de lecture irrégulière non
 * alignable, repli : un seul segment avec toute la lecture en ruby.
 */
export function fitFurigana(surface: string, reading?: string): RubySegment[] {
  if (!hasKanji(surface)) return [{ base: surface }];
  if (!reading) return [{ base: surface }];

  const readingHira = kataToHira(reading);
  const runs = splitRuns(surface);

  // Surface entièrement kanji → toute la lecture en ruby.
  if (runs.length === 1 && runs[0].kanji) {
    return [{ base: surface, ruby: readingHira }];
  }

  // Construit un motif : kanji → groupe capturant, kana → littéral (normalisé hiragana).
  let pattern = "^";
  for (const run of runs) {
    pattern += run.kanji ? "(.+?)" : escapeRegex(kataToHira(run.text));
  }
  pattern += "$";

  const m = readingHira.match(new RegExp(pattern));
  if (!m) {
    // Lecture non alignable (ex. lecture spéciale) → ruby global sur la surface.
    return [{ base: surface, ruby: readingHira }];
  }

  const segments: RubySegment[] = [];
  let gi = 1;
  for (const run of runs) {
    if (run.kanji) segments.push({ base: run.text, ruby: m[gi++] });
    else segments.push({ base: run.text });
  }
  return segments;
}

/** Un token annoté pour le rendu. */
export interface AnnotatedToken {
  surface: string;
  segments: RubySegment[];
  token: KuromojiToken;
}

/** Annote une liste de tokens kuromoji avec leurs furigana. */
export function annotateTokens(tokens: KuromojiToken[]): AnnotatedToken[] {
  const result: AnnotatedToken[] = [];
  for (const t of tokens) {
    const prev = result[result.length - 1];
    // Skip inline-furigana tokens: old content used "漢字ひらがな" format (e.g. 私わたし).
    // When kuromoji splits this into [私(reading:ワタシ), わたし], the kana token is redundant.
    if (
      prev &&
      prev.token.reading &&
      hasKanji(prev.token.surface_form) &&
      !hasKanji(t.surface_form) &&
      kataToHira(prev.token.reading) === t.surface_form
    ) {
      continue;
    }
    result.push({
      surface: t.surface_form,
      segments: fitFurigana(t.surface_form, t.reading),
      token: t,
    });
  }
  return result;
}
