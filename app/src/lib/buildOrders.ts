// Validation souple de la reconstruction de phrase : le japonais permet de permuter
// les constituants marqués par une particule tant que le prédicat reste final
// (私は今日学校に行きます ≡ 今日私は学校に行きます). On découpe la phrase en chunks
// façon bunsetsu, et on accepte toute permutation des chunks "movables" d'un même
// segment contigu — les chunks non movables (prédicats, conjonctions) font barrière,
// donc rien ne franchit une frontière de proposition. Heuristique volontairement
// prudente : l'ordre canonique passe toujours (court-circuit), les faux-rejets sont
// le vrai bug UX, les faux-acceptés restent des ordres où chaque constituant est intact.

import { toTiles } from "./builder";
import type { KuromojiToken } from "./tokenizer";

export interface Chunk {
  tiles: string[];
  movable: boolean;
}

/** POS qui ouvrent un chunk (têtes de bunsetsu) ; particules/auxiliaires s'y rattachent. */
const CHUNK_START_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞", "接頭詞", "接続詞", "感動詞"]);
/** Particules casuelles/thématiques dont le syntagme peut se déplacer devant le prédicat. */
const MOVABLE_PARTICLES = new Set(["は", "も", "が", "を", "に", "で", "へ", "と", "から", "まで"]);
/** Un chunk contenant un prédicat (verbe/adjectif/auxiliaire) ne se déplace jamais. */
const PREDICATE_POS = new Set(["動詞", "形容詞", "助動詞"]);

/** Découpe façon bunsetsu : chunk ouvert à chaque tête, の-final fusionné avec le suivant. */
export function toChunks(tokens: KuromojiToken[]): Chunk[] {
  const clean = tokens.filter((t) => t.pos !== "記号" && t.surface_form.trim().length > 0);

  const groups: KuromojiToken[][] = [];
  let attachNext = false; // vrai après un 接頭詞 : la tête suivante reste dans le même chunk
  for (const t of clean) {
    if (groups.length === 0 || (CHUNK_START_POS.has(t.pos) && !attachNext)) groups.push([t]);
    else groups[groups.length - 1].push(t);
    attachNext = t.pos === "接頭詞";
  }

  // 私の + 本 → 私の本 : un syntagme en の reste soudé à son nom.
  const merged: KuromojiToken[][] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    const prevLast = prev?.[prev.length - 1];
    if (prevLast && prevLast.pos === "助詞" && prevLast.surface_form === "の") prev.push(...g);
    else merged.push(g);
  }

  return merged.map((g, i) => {
    const last = g[g.length - 1];
    const isFinal = i === merged.length - 1;
    const hasPredicate = g.some((t) => PREDICATE_POS.has(t.pos));
    // 接続助詞 exclu (食べて, 行くから…) : c'est une jointure de propositions, pas un cas.
    const endsWithCaseParticle =
      last.pos === "助詞" && last.pos_detail_1 !== "接続助詞" && MOVABLE_PARTICLES.has(last.surface_form);
    // Adverbe nu (今日, 毎日, とても) : se déplace sans particule.
    const bareAdverb =
      g.length === 1 && (g[0].pos === "副詞" || (g[0].pos === "名詞" && g[0].pos_detail_1 === "副詞可能"));
    const movable = !isFinal && ((endsWithCaseParticle && !hasPredicate) || bareAdverb);
    return { tiles: g.map((t) => t.surface_form), movable };
  });
}

/**
 * Vrai si `assembled` est un ordre acceptable de la phrase : l'ordre canonique, ou une
 * permutation des chunks movables à l'intérieur de chaque segment contigu (backtracking —
 * les tuiles dupliquées rendent le glouton ambigu). Chaque chunk doit rester intact.
 */
export function isAcceptableOrder(assembled: string[], tokens: KuromojiToken[]): boolean {
  const target = toTiles(tokens);
  if (assembled.length !== target.length) return false;
  if (assembled.every((s, i) => s === target[i])) return true;

  const chunks = toChunks(tokens);
  const consumed = chunks.map(() => false);

  const match = (pos: number): boolean => {
    const f = consumed.indexOf(false);
    if (f === -1) return pos === assembled.length;
    const candidates: number[] = [];
    if (!chunks[f].movable) {
      candidates.push(f);
    } else {
      // Tout chunk movable non consommé du même segment contigu peut venir ici.
      for (let i = f; i < chunks.length && chunks[i].movable; i++) {
        if (!consumed[i]) candidates.push(i);
      }
    }
    for (const ci of candidates) {
      const tiles = chunks[ci].tiles;
      if (tiles.every((tl, j) => assembled[pos + j] === tl)) {
        consumed[ci] = true;
        if (match(pos + tiles.length)) return true;
        consumed[ci] = false;
      }
    }
    return false;
  };

  return match(0);
}
