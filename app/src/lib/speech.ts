// Quel TEXTE envoyer à la synthèse vocale pour un mot ou un kanji isolé.
//
// Un moteur de synthèse doit deviner la lecture des kanji qu'on lui donne, et hors phrase
// il devine mal : 宝 seul sort « takaramono » (il complète en 宝物) au lieu de « takara »,
// un composé peu courant sort lu kanji par kanji. La graphie n'est donc PAS ce qu'il faut
// prononcer : le référentiel connaît déjà la lecture de chaque mot, et le kana ne laisse
// aucune place à la devinette. Ces fonctions choisissent ce texte ; la lecture elle-même
// vit dans lib/tts.ts (speakWord).

import { isKana, splitEntryForms } from "./kana";

/** Alternatives d'une entrée du dico listées à la japonaise (« 回る、回す »). */
const ALT_SEPARATORS = /[、，,]/;

/** Première forme prononçable d'une entrée du dico
    (cf. splitEntryForms : tilde d'affixe, « (する) », « a; b »). */
function firstForm(entry: string | undefined): string {
  if (!entry) return "";
  return splitEntryForms(entry.split(ALT_SEPARATORS)[0])[0] ?? "";
}

function allKana(s: string): boolean {
  return s.length > 0 && [...s].every(isKana);
}

/**
 * Texte à prononcer pour un mot : sa LECTURE en kana quand on la connaît, sa graphie
 * sinon. Les conventions d'affichage du dico (tilde d'affixe, suffixe optionnel entre
 * parenthèses, alternatives) sont retirées — on prononce la première forme développée.
 * Une lecture qui n'est pas entièrement en kana (absente, ou inversée avec la graphie
 * comme « いただく|頂く ») est ignorée : la graphie reprend la main.
 */
export function wordSpeechText(surface: string, reading?: string): string {
  const read = firstForm(reading);
  if (allKana(read)) return read;
  return firstForm(surface) || surface;
}

/** Marqueurs KANJIDIC : point d'okurigana (« たか.い »),
    tiret d'affixe (« -だか », « おお- »). */
const KANJIDIC_MARKS = /[.．・-]/g;

/** Vrai si la lecture est une forme affixale (préfixe/suffixe) : jamais prononcée seule. */
function isAffix(reading: string): boolean {
  return reading.startsWith("-") || reading.endsWith("-");
}

/**
 * Texte à prononcer pour un kanji isolé — qui n'a pas UNE lecture mais une liste. On
 * prend la lecture qui s'emploie telle quelle : d'abord un kun nu (たから pour 宝, ひ
 * pour 日), sinon un on (しん pour 新, dont tous les kun demandent des okurigana),
 * sinon un kun avec okurigana amputé de son point (たかい pour 高). Chaîne vide si le
 * kanji ne porte aucune lecture — à l'appelant de retomber sur le caractère.
 */
export function kanjiSpeechText(kun: string[], on: string[]): string {
  const plain = kun.filter((r) => !isAffix(r) && !r.includes("."));
  const withOkurigana = kun.filter((r) => !isAffix(r));
  const first = [...plain, ...on, ...withOkurigana, ...kun].find((r) => r.trim().length > 0) ?? "";
  return first.replace(KANJIDIC_MARKS, "");
}
