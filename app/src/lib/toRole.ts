// L'emploi de と dans sa phrase. kuromoji ne le départage pas de façon fiable : 私とあなたは
// sort 格助詞 (« avec »), 犬と歩く 引用 (citation), 母と日本へ行く 並立 (« et »). Le contexte,
// lui, le dit : ce qui suit と (un verbe de parole, un nom et sa particule) et ce qui le précède
// (des guillemets, un verbe). Partagé par le gloss du Lecteur et la fiche du mot.

import type { KuromojiToken } from "./tokenizer";

export type ToRole = "quote" | "and" | "with" | "and-or-with" | "conditional";

/** Verbes qui introduisent des paroles ou une pensée : 「…」と言う, …と思う. */
const QUOTE_VERBS = new Set([
  "言う", "いう", "思う", "おもう", "考える", "答える", "聞く", "訊く", "書く", "叫ぶ", "呼ぶ",
  "尋ねる", "説明する", "感じる", "伝える", "決める", "信じる", "言える", "申す", "おっしゃる",
  "頼む", "述べる", "返事する", "つぶやく",
]);
// Pas 話す, 笑う, 約束する : 先生と話す, 友だちと笑う se font « avec ». Après 」, と cite
// quel que soit le verbe.

const QUOTE_CLOSERS = new Set(["」", "』", "”", "\""]);

/** L'emploi du と en position `i`, ou null si ce n'est pas la particule と. */
export function toRole(tokens: KuromojiToken[], i: number): ToRole | null {
  const t = tokens[i];
  if (t?.pos !== "助詞" || t.surface_form !== "と") return null;
  const prev = tokens[i - 1];
  if (prev && QUOTE_CLOSERS.has(prev.surface_form)) return "quote";
  // Le verbe qui suit, au plus quelques tokens plus loin (と先生が言った, とタロウは答えた).
  for (let j = i + 1; j < Math.min(tokens.length, i + 5); j++) {
    const n = tokens[j];
    if (n.pos === "記号" && n.pos_detail_1 === "句点") break;
    if (n.pos === "動詞" && n.pos_detail_1 === "自立") {
      if (QUOTE_VERBS.has(n.basic_form)) return "quote";
      break;
    }
  }
  if (t.pos_detail_1 === "接続助詞" || (prev && (prev.pos === "動詞" || prev.pos === "形容詞" || prev.pos === "助動詞")))
    return t.pos_detail_2 === "引用" ? "quote" : "conditional";
  const next = tokens[i + 1];
  if (next?.pos === "名詞") {
    // N と N は/が/も : une liste ; N と N を : ambigu (友だちと映画を見る) ; sinon « avec ».
    let j = i + 1;
    while (tokens[j + 1]?.pos === "名詞") j++;
    const after = tokens[j + 1];
    if (after?.pos === "助詞" && ["は", "が", "も", "の", "や"].includes(after.surface_form)) return "and";
    if (!after || after.pos === "記号") return "and"; // 山と川。
    if (after?.surface_form === "を") return "and-or-with";
    return "with";
  }
  return "with";
}
