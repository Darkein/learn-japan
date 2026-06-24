// Pont navigateur : tokenise puis annote (furigana) et glose (littéral) une phrase.
import { contentDict } from "./data";
import { annotateTokens, type AnnotatedToken } from "./furigana";
import { glossTokens, type GlossSegment } from "./gloss";
import { tokenize } from "./tokenizer";

export interface AnalyzedSentence {
  tokens: AnnotatedToken[];
  gloss: GlossSegment[];
}

export async function analyze(text: string): Promise<AnalyzedSentence> {
  const tokens = await tokenize(text);
  return {
    tokens: annotateTokens(tokens),
    gloss: glossTokens(tokens, contentDict),
  };
}
