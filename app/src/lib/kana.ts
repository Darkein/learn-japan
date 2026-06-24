// Utilitaires kana — purs, testables, sans dépendance.

const KATA_START = 0x30a1;
const KATA_END = 0x30f6;
const KATA_TO_HIRA_OFFSET = 0x60;

/** Convertit une chaîne katakana en hiragana (les autres caractères sont inchangés). */
export function kataToHira(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= KATA_START && code <= KATA_END) {
      out += String.fromCodePoint(code - KATA_TO_HIRA_OFFSET);
    } else if (ch === "ー") {
      out += "ー";
    } else {
      out += ch;
    }
  }
  return out;
}

/** Vrai si le caractère est un hiragana ou katakana (kana). */
export function isKana(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x3041 && code <= 0x3096) || // hiragana
    (code >= 0x30a1 && code <= 0x30fa) || // katakana
    ch === "ー" ||
    ch === "ｰ"
  );
}

/** Vrai si le caractère est un kanji (idéogramme CJK courant). */
export function isKanji(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    ch === "々"
  );
}

/** Vrai si la chaîne contient au moins un kanji. */
export function hasKanji(s: string): boolean {
  for (const ch of s) if (isKanji(ch)) return true;
  return false;
}
