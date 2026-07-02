// Reconstruction de phrase (rappel actif) : à partir de la traduction française, l'utilisateur
// réordonne des tuiles de mots japonais. Helpers PURS (sans React/DOM) → testables.

import { shuffle } from "./random";
import type { KuromojiToken } from "./tokenizer";

/** Une tuile à poser : surface du mot + clé stable (gère les surfaces dupliquées, ex. deux « は »). */
export interface Tile {
  tile: string;
  key: number;
}

/** Surfaces des tokens HORS ponctuation (`pos === "記号"`), dans l'ordre → la cible à reconstituer. */
export function toTiles(tokens: KuromojiToken[]): string[] {
  return tokens
    .filter((t) => t.pos !== "記号" && t.surface_form.trim().length > 0)
    .map((t) => t.surface_form);
}

/** Mélange en attribuant une clé stable par tuile, pour le rendu et le retrait. */
export function shuffleTiles(tiles: string[]): Tile[] {
  return shuffle(tiles.map((tile, key) => ({ tile, key })));
}

/** Vrai si la suite de surfaces assemblée reproduit la cible (doublons compris). */
export function isCorrectOrder(assembled: string[], target: string[]): boolean {
  if (assembled.length !== target.length) return false;
  return assembled.every((s, i) => s === target[i]);
}
