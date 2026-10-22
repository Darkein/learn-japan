// Le point de grammaire d'un morphème (particule, auxiliaire, verbe non autonome) et la leçon
// qui l'enseigne. Le Lecteur ne suit pas ces mots en vocabulaire : leur fiche dit où ils
// s'apprennent dans le parcours, plutôt que de promettre une piste « à venir ».
//
// Déterministe, sans LLM : la FORME d'un point (`grammarForm` : « は », « から », « 〜たり… »)
// est comparée à la graphie et à la forme de base du token. Une forme portée par plusieurs
// points (に : lieu, moment, destination) les rend tous — le token seul ne dit pas l'emploi,
// sauf quand sa catégorie le tranche (から 格助詞 = provenance, 接続助詞 = cause).

import { getCurriculum, lessonsForGrammar, type CurriculumEntry } from "./curriculum";
import { allGrammarInv, grammarForm } from "./inventory";
import type { KuromojiToken } from "./tokenizer";

export interface MorphemePoint {
  id: string;
  name: string;
  /** La leçon qui introduit le point (la première, dans l'ordre du curriculum). */
  lesson?: CurriculumEntry;
}

/** Formes qu'un token porte et que le nom du point ne dit pas (て-forme, 〜ている…). */
const ALIASES: Record<string, string[]> = {
  "n5-te-form": ["て", "で"],
  "n5-teiru-progressive": ["いる"],
  "n5-te-kudasai": ["ください"],
};

/**
 * Catégorie IPADIC (`pos_detail_1`, ou `pos_detail_1/pos_detail_2`) qu'exige un point dont la
 * forme est partagée : c'est elle qui départage から provenance et から cause, と « et », と
 * « avec » et と condition, いる et 〜ている. Le と de citation (「はい」と言った, 格助詞/引用)
 * n'en incarne aucun : le référentiel n'a pas de point pour lui.
 */
const POS_DETAIL: Record<string, string> = {
  "n5-te-form": "接続助詞",
  "n5-kara-from": "格助詞",
  "n4-kara-cause": "接続助詞",
  "n5-to-and": "並立助詞",
  "n5-to-with": "格助詞/一般",
  "n4-to-conditional": "接続助詞",
  "n5-ga-subject": "格助詞",
  "n5-de-place": "格助詞",
  "n5-de-means": "格助詞",
  "n5-ni-location": "格助詞",
  "n5-ni-time": "格助詞",
  "n5-ni-direction": "格助詞",
  "n5-iru": "自立",
  "n5-teiru-progressive": "非自立",
  "n5-te-kudasai": "非自立",
};

function matchesPos(token: KuromojiToken, pos: string): boolean {
  const [d1, d2] = pos.split("/");
  return token.pos_detail_1 === d1 && (d2 === undefined || token.pos_detail_2 === d2);
}

const JAPANESE_ONLY = /^[぀-ヿ一-鿿]+$/;

/** Les formes d'un point que peut porter un token : « これ/それ/あれ » → trois, « 〜たり〜たりする » → たり. */
function formsOf(name: string): string[] {
  return grammarForm(name)
    .split(/[/／]/)
    .map((f) => f.trim().replace(/^〜/, "").split("〜")[0].replace(/-forme$/, ""))
    .filter((f) => JAPANESE_ONLY.test(f));
}

let index: Map<string, { id: string; name: string }[]> | null = null;

function formIndex(): Map<string, { id: string; name: string }[]> {
  if (index) return index;
  index = new Map();
  for (const g of allGrammarInv()) {
    for (const f of new Set([...formsOf(g.name), ...(ALIASES[g.id] ?? [])])) {
      const list = index.get(f) ?? [];
      list.push({ id: g.id, name: g.name });
      index.set(f, list);
    }
  }
  return index;
}

/** Les points de grammaire qu'un morphème peut incarner, chacun avec sa leçon (ordre du curriculum). */
export function grammarPointsFor(token: KuromojiToken): MorphemePoint[] {
  const idx = formIndex();
  const seen = new Set<string>();
  const points: MorphemePoint[] = [];
  for (const form of new Set([token.surface_form, token.basic_form])) {
    for (const g of idx.get(form) ?? []) {
      if (seen.has(g.id)) continue;
      const pos = POS_DETAIL[g.id];
      if (pos && !matchesPos(token, pos)) continue;
      seen.add(g.id);
      points.push({ ...g, lesson: lessonsForGrammar([g.id])[0] });
    }
  }
  const order = new Map(getCurriculum().map((c, i) => [c.id, i]));
  const rank = (p: MorphemePoint) => (p.lesson ? (order.get(p.lesson.id) ?? Infinity) : Infinity);
  return points.sort((a, b) => rank(a) - rank(b));
}
