// Pont navigateur : tokenise puis annote (furigana) et glose (littéral) une phrase.
import { loadContentDict } from "./data";
import { annotateTokens, type AnnotatedToken } from "./furigana";
import { glossTokens, type GlossSegment } from "./gloss";
import { tokenize } from "./tokenizer";

export interface AnalyzedSentence {
  tokens: AnnotatedToken[];
  gloss: GlossSegment[];
}

export async function analyze(text: string): Promise<AnalyzedSentence> {
  const [tokens, dict] = await Promise.all([tokenize(text), loadContentDict()]);
  return {
    tokens: annotateTokens(tokens),
    gloss: glossTokens(tokens, dict),
  };
}
