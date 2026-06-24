// Tokenisation morphologique déterministe (kuromoji / IPADIC), côté navigateur.
// Une seule passe fournit à la fois le reading (furigana) et la nature grammaticale (gloss).
//
// ⚠️ Déviation actée vs SPEC (UniDic) : en JS pur dans le navigateur on utilise IPADIC.
// Bien plus fiable qu'un LLM, mais non infaillible (compteurs, 行った, noms propres) →
// la correction manuelle et le dico de noms propres arrivent dans une phase ultérieure.

import kuromoji from "@sglkc/kuromoji";

/** Token kuromoji (champs utiles). `reading`/`pronunciation` sont en katakana. */
export interface KuromojiToken {
  surface_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  basic_form: string;
  reading?: string;
  pronunciation?: string;
}

interface Tokenizer {
  tokenize(text: string): KuromojiToken[];
}

/** Chemin du dictionnaire : servi sous `<base>/dict/` (copié dans public/ au build). */
function defaultDicPath(): string {
  const base =
    typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : "/";
  return `${base}dict/`;
}

let tokenizerPromise: Promise<Tokenizer> | null = null;

/** Construit (une seule fois) et mémorise le tokenizer. */
export function getTokenizer(dicPath: string = defaultDicPath()): Promise<Tokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji
        .builder({ dicPath })
        .build((err: Error | null, tokenizer: Tokenizer) => {
          if (err) reject(err);
          else resolve(tokenizer);
        });
    });
  }
  return tokenizerPromise;
}

/** Tokenise une phrase japonaise. */
export async function tokenize(text: string): Promise<KuromojiToken[]> {
  const tokenizer = await getTokenizer();
  return tokenizer.tokenize(text);
}
