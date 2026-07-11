// Gloss interlinéaire LITTÉRAL (déterministe) — cf. SPEC §4.2.
// 暑い です ね  →  être-chaud · c'est(poli) · [accord]
//
// Mots de contenu : glosés via un dictionnaire (sous-ensemble JMdict, en français).
// Particules / auxiliaires / copule : table fixe (particles.ts). Pas de LLM.

import { AUX_GLOSS, AUX_VERB_GLOSS, PARTICLE_GLOSS, TE_FORMS } from "./particles";
import type { KuromojiToken } from "./tokenizer";

/** Dictionnaire de contenu : forme de base → gloss français court. */
export type ContentDict = Record<string, string>;

export interface GlossSegment {
  surface: string;
  gloss: string;
  /** true si c'est un morphème grammatical (particule/auxiliaire), pour le style. */
  grammatical: boolean;
}

function lookupContent(token: KuromojiToken, dict: ContentDict): string {
  return (
    dict[token.basic_form] ??
    dict[token.surface_form] ??
    token.basic_form ??
    token.surface_form
  );
}

/** Glose un seul token. */
export function glossToken(token: KuromojiToken, dict: ContentDict): GlossSegment {
  const surface = token.surface_form;
  const g = (gloss: string, grammatical = false): GlossSegment => ({
    surface,
    gloss,
    grammatical,
  });

  switch (token.pos) {
    case "助詞": {
      // forme て/で de liaison (接続助詞)
      if (token.pos_detail_1 === "接続助詞" && TE_FORMS[surface]) {
        return g(TE_FORMS[surface], true);
      }
      return g(PARTICLE_GLOSS[surface] ?? PARTICLE_GLOSS[token.basic_form] ?? "[particule]", true);
    }
    case "助動詞":
      return g(AUX_GLOSS[surface] ?? AUX_GLOSS[token.basic_form] ?? "[aux]", true);
    case "記号":
      return g(surface, true);
    case "形容詞": {
      // i-adjectif : gloss prédicatif « être-X » (cf. exemple atsui → être-chaud),
      // sauf si le gloss est déjà verbal (ない → « ne pas être… », pas « être-ne pas… »).
      const base = dict[token.basic_form] ?? token.basic_form;
      return g(base.startsWith("ne pas") ? base : `être-${base}`);
    }
    case "動詞": {
      // verbe support non autonome (ている, てしまう…)
      if (token.pos_detail_1 === "非自立" && AUX_VERB_GLOSS[token.basic_form]) {
        return g(AUX_VERB_GLOSS[token.basic_form], true);
      }
      return g(lookupContent(token, dict));
    }
    default:
      return g(lookupContent(token, dict));
  }
}

/** Glose une phrase entière (liste de tokens). */
export function glossTokens(tokens: KuromojiToken[], dict: ContentDict): GlossSegment[] {
  return tokens.map((t) => glossToken(t, dict));
}

/** Rendu texte compact du gloss : « être-chaud · c'est(poli) · [accord] ». */
export function glossString(segments: GlossSegment[]): string {
  return segments.map((s) => s.gloss).join(" · ");
}
