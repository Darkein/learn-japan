// Pont navigateur : tokenise puis annote (furigana) et glose (littéral) une phrase.
import { loadContentDict } from "./data";
import { annotateTokens, type AnnotatedToken } from "./furigana";
import { glossTokens, type GlossSegment } from "./gloss";
import { tokenize } from "./tokenizer";

export interface AnalyzedSentence {
  tokens: AnnotatedToken[];
  gloss: GlossSegment[];
}

// Cache mémoire borné (LRU simple) : `analyze` est une fonction pure de `text`. Évite de
// ré-analyser un même texte — notamment quand une page voisine, affichée en aperçu pendant le
// carrousel, se remonte en page active après validation (sinon flash de rechargement).
const CACHE_MAX = 12;
const cache = new Map<string, Promise<AnalyzedSentence>>();
// Valeurs résolues, pour un accès SYNCHRONE (peekAnalysis) : permet au lecteur d'initialiser
// son rendu sans passer par l'état « Chargement du tokenizer… » quand le texte a déjà été
// analysé (ex. page voisine affichée en aperçu pendant le carrousel, puis rendue active).
const resolved = new Map<string, AnalyzedSentence>();

/** Résultat déjà résolu pour ce texte, s'il est en cache — synchrone, sinon `undefined`. */
export function peekAnalysis(text: string): AnalyzedSentence | undefined {
  return resolved.get(text);
}

export function analyze(text: string): Promise<AnalyzedSentence> {
  const hit = cache.get(text);
  if (hit) {
    // Re-marque comme récemment utilisé (réinsertion en fin d'ordre d'itération).
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const p = compute(text);
  cache.set(text, p);
  // Éviction de la plus ancienne entrée au-delà de la borne (des deux caches).
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      resolved.delete(oldest);
    }
  }
  // En cas d'échec, ne pas mémoriser un rejet permanent : on purge pour permettre un réessai.
  p.then((v) => resolved.set(text, v)).catch(() => cache.delete(text));
  return p;
}

async function compute(text: string): Promise<AnalyzedSentence> {
  const [tokens, dict] = await Promise.all([tokenize(text), loadContentDict()]);
  return {
    tokens: annotateTokens(tokens),
    gloss: glossTokens(tokens, dict),
  };
}
