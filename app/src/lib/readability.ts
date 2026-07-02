// Lisibilité d'une histoire : part des OCCURRENCES de mots de contenu que l'apprenant
// connaît (statut « connu ») ou travaille (« à revoir »). La lecture extensive fonctionne
// autour de ~90-95 % de couverture connue : ce score aide à choisir quoi lire.

import type { ItemStatus } from "./db";
import { tokenize, type KuromojiToken } from "./tokenizer";
import { isContent, itemIdFor, statusesFor } from "./vocab";

export interface Readability {
  /** Occurrences de mots de contenu dans le texte. */
  total: number;
  /** Occurrences dont le mot est « connu ». */
  known: number;
  /** Occurrences dont le mot est « à revoir » (en rotation SRS). */
  learning: number;
  /** Couverture connue (0..1) : known / total. 1 si le texte n'a aucun mot de contenu. */
  coverage: number;
}

/** Partie pure : compte la couverture à partir des tokens et des statuts connus. */
export function computeReadability(
  tokens: KuromojiToken[],
  statuses: Map<string, ItemStatus>,
): Readability {
  let total = 0;
  let known = 0;
  let learning = 0;
  for (const t of tokens) {
    if (!isContent(t)) continue;
    total++;
    const st = statuses.get(itemIdFor(t));
    if (st === "known") known++;
    else if (st === "review") learning++;
  }
  return { total, known, learning, coverage: total === 0 ? 1 : known / total };
}

/** Tokenise le texte et calcule sa lisibilité par rapport à l'état SRS local. */
export async function storyReadability(text: string): Promise<Readability> {
  const tokens = await tokenize(text);
  const ids = [...new Set(tokens.filter(isContent).map(itemIdFor))];
  const statuses = await statusesFor(ids);
  return computeReadability(tokens, statuses);
}
