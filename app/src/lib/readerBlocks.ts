// Regroupe les tokens analysés (résultat plat de analyze()) par paragraphe/titre source, pour
// que le lecteur (Reader.tsx) affiche les articles importés avec leur mise en page d'origine
// (titres distincts, paragraphes espacés) SANS changer la tokenisation ni les index utilisés
// par le karaoké audio : currentTokenIndex reste un index dans le tableau plat de tokens.
import type { ArticleParagraph } from "./db";

export interface TokenBlock {
  type: ArticleParagraph["type"];
  /** Indices dans le tableau plat de tokens/gloss appartenant à ce bloc, dans l'ordre. */
  tokenIndices: number[];
}

/**
 * Répartit les indices de `tokens` (ordre de `incoming.text`) selon les frontières de
 * `paragraphs`, reconstituées par longueur de caractères cumulée (les paragraphes sont joints
 * par un seul "\n" au stockage — cf. articleExtract.ts). Repose sur le fait que la
 * concaténation des surfaces de tokens reconstitue le texte source ; en cas de léger décalage
 * (ex. token fusionné par annotateTokens), les tokens qui suivent restent rattachés au
 * paragraphe courant jusqu'à la frontière suivante — dégradation sans perte de tokens.
 */
export function groupTokensByParagraphs(
  paragraphs: ArticleParagraph[] | undefined,
  tokens: { surface: string }[],
): TokenBlock[] | null {
  if (!paragraphs || paragraphs.length === 0 || tokens.length === 0) return null;

  const boundaries: number[] = [];
  let acc = 0;
  paragraphs.forEach((p, i) => {
    acc += p.text.length;
    boundaries.push(acc);
    if (i < paragraphs.length - 1) acc += 1; // le "\n" séparateur
  });

  const blocks: TokenBlock[] = paragraphs.map((p) => ({ type: p.type, tokenIndices: [] }));
  let charPos = 0;
  let bi = 0;
  for (let i = 0; i < tokens.length; i++) {
    while (bi < boundaries.length - 1 && charPos >= boundaries[bi]) bi++;
    blocks[bi].tokenIndices.push(i);
    charPos += tokens[i].surface.length;
  }
  return blocks;
}
