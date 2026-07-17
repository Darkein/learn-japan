// Moyens mnémotechniques (corpus statiques générés par scripts/build-mnemonics.ts et
// build-word-mnemonics.ts) : fichiers FRÈRES de kanji.json / vocab.json (les scripts ne
// réécrivent qu'eux, sans toucher la donnée curée). Clés : caractère (kanji) /
// `surface|lecture` (mot).
//
// Chargés en import DYNAMIQUE (≈ 660 Ko de JSON) : seuls WordSheet/KanjiSheet en ont
// besoin, et les garder hors du bundle principal le maintient sous la limite de
// precache Workbox (2 Mio). Les chunks restent precachés → dispo hors-ligne.
// `import()` est mémoïsé par le runtime : pas de cache manuel nécessaire.

import type { Mnemonic } from "./genParsers";

/** Moyen mnémotechnique d'un kanji (par caractère), si généré. */
export async function kanjiMnemonic(ch: string): Promise<Mnemonic | undefined> {
  const data = (await import("../data/inventory/kanji-mnemonics.json")).default;
  return (data as Record<string, Mnemonic>)[ch];
}

/** Moyen mnémotechnique d'un mot de vocabulaire (par id `surface|lecture`), si généré. */
export async function vocabMnemonic(id: string): Promise<Mnemonic | undefined> {
  const data = (await import("../data/inventory/vocab-mnemonics.json")).default;
  return (data as Record<string, Mnemonic>)[id];
}
