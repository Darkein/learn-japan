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

/**
 * Normalise une réponse pour le rappel actif (cloze à saisir) : katakana → hiragana,
 * espaces retirés, bornes nettoyées. Comparaison robuste saisie ↔ réponse attendue ; les
 * kanji sont laissés intacts (sert aussi à valider un mot tapé en kanji côté vocab).
 */
export function normalizeReading(s: string): string {
  return kataToHira(s).replace(/\s+/g, "").trim();
}

/** Marqueurs de dico jamais tapés par l'apprenant (tilde d'affixe, pleine ou demi-chasse). */
const AFFIX_MARK = /[～〜~]/g;

/**
 * Développe une entrée du dico (surface ou lecture) en toutes les réponses acceptables
 * pour un exercice de saisie. Les entrées portent des conventions d'affichage — utiles à
 * la lecture, mais qu'on ne peut pas taper telles quelles :
 *   - alternatives séparées par `;` (« いい; よい », « 足; 脚 ») → chaque variante compte ;
 *   - partie optionnelle entre parenthèses (« べんきょう (する) ») → avec ET sans le suffixe ;
 *   - marqueur d'affixe `～` (« ～円 », « ～えん ») → retiré.
 * Chaque variante est passée à `normalizeReading` ; le résultat est dédoublonné, sans vide.
 */
export function answerVariants(...entries: string[]): string[] {
  const out = new Set<string>();
  for (const entry of entries) {
    for (const alt of entry.split(/[;；]/)) {
      const dropped = alt.replace(/[（(][^）)]*[）)]/g, ""); // suffixe optionnel omis
      const kept = alt.replace(/[（()）]/g, ""); // suffixe optionnel conservé
      for (const v of [dropped, kept]) {
        const norm = normalizeReading(v.replace(AFFIX_MARK, ""));
        if (norm) out.add(norm);
      }
    }
  }
  return [...out];
}

const JA_SENTENCE_END = /[。！？．!?]/;

/** Vrai si le caractère est une ponctuation finale de phrase japonaise. */
export function isJaSentenceEnd(ch: string): boolean {
  return JA_SENTENCE_END.test(ch);
}

/**
 * Découpe un texte japonais en phrases (sur la ponctuation finale et les sauts de ligne),
 * en conservant la ponctuation. Déterministe → mêmes bornes pour la traduction alignée,
 * le QCM de compréhension et l'assemblage du podcast.
 */
export function splitJaSentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\n") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
    if (JA_SENTENCE_END.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
