// Formes conjuguées d'un mot attendu en saisie : demander « manger » et recevoir たべます,
// c'est avoir trouvé le mot — la forme de dictionnaire n'est qu'une convention de fiche.
// Table FIXE de règles, pas de LLM (même parti que lib/blankRule.ts) ; seule la CLASSE du
// mot (godan, ichidan, adjectif en い…) vient de kuromoji, lu sur la graphie de la fiche,
// où elle est fiable — sur une saisie en kana, 「たべます」 seul est ambigu.

import { normalizeReading } from "./kana";

/** Classe de conjugaison d'un mot de fiche. */
export type ConjClass =
  | { kind: "ichidan" }
  /** Godan ; `iku` : 行く, seul en く dont la て-forme est en って (行って). */
  | { kind: "godan"; iku?: boolean }
  | { kind: "suru" }
  | { kind: "kuru" }
  | { kind: "adj-i" };

/** Rangées du godan : final en う → [い, あ, え, お] (base en ます, ない, ば, volitif). */
const GODAN_ROWS: Record<string, [i: string, a: string, e: string, o: string]> = {
  う: ["い", "わ", "え", "お"],
  く: ["き", "か", "け", "こ"],
  ぐ: ["ぎ", "が", "げ", "ご"],
  す: ["し", "さ", "せ", "そ"],
  つ: ["ち", "た", "て", "と"],
  ぬ: ["に", "な", "ね", "の"],
  ぶ: ["び", "ば", "べ", "ぼ"],
  む: ["み", "ま", "め", "も"],
  る: ["り", "ら", "れ", "ろ"],
};

/** Forme en て du godan (sans le て/で final) + voisement : 書く → 書い+て, 読む → 読ん+で. */
function godanTe(stem: string, last: string, iku?: boolean): [string, "て" | "で"] {
  if (iku) return [stem + "っ", "て"];
  switch (last) {
    case "く":
      return [stem + "い", "て"];
    case "ぐ":
      return [stem + "い", "で"];
    case "す":
      return [stem + "し", "て"];
    case "ぬ":
    case "ぶ":
    case "む":
      return [stem + "ん", "で"];
    default: // う, つ, る
      return [stem + "っ", "て"];
  }
}

/** Formes verbales bâties sur les bases : ます-base, ない-base, て/た, ば, volitif. */
function verbForms(masu: string, nai: string, te: string, ta: string, ba: string, vol: string): string[] {
  return [
    ...["ます", "ません", "ました", "ませんでした", "ましょう", "たい", "たくない", "たかった"].map(
      (s) => masu + s,
    ),
    ...["ない", "なかった", "なくて"].map((s) => nai + s),
    te,
    ta,
    te + "いる",
    te + "います",
    te + "ください",
    ba,
    vol,
  ];
}

/**
 * Formes conjuguées courantes de `dict` (forme de dictionnaire, en kana ou en kanji) selon
 * sa classe. Liste vide si `dict` ne porte pas la terminaison attendue — on ne devine pas.
 */
export function conjugations(dict: string, cls: ConjClass): string[] {
  const last = dict.slice(-1);
  const stem = dict.slice(0, -1);
  switch (cls.kind) {
    case "ichidan":
      if (last !== "る") return [];
      return verbForms(stem, stem, stem + "て", stem + "た", stem + "れば", stem + "よう");
    case "godan": {
      const row = GODAN_ROWS[last];
      if (!row) return [];
      const [te0, t] = godanTe(stem, last, cls.iku);
      const ta = te0 + (t === "て" ? "た" : "だ");
      return verbForms(stem + row[0], stem + row[1], te0 + t, ta, stem + row[2] + "ば", stem + row[3] + "う");
    }
    case "suru": {
      if (!dict.endsWith("する")) return [];
      const p = dict.slice(0, -2);
      return verbForms(p + "し", p + "し", p + "して", p + "した", p + "すれば", p + "しよう");
    }
    case "kuru": {
      // 来る : base en ます き, base en ない こ — la graphie kanji garde 来 partout.
      if (!/^(来|く)る$/.test(dict.slice(-2))) return [];
      const p = dict.slice(0, -2);
      const kanji = dict.slice(-2, -1) === "来";
      const k = kanji ? "来" : "き";
      const ko = kanji ? "来" : "こ";
      return verbForms(p + k, p + ko, p + k + "て", p + k + "た", p + (kanji ? "来" : "く") + "れば", p + ko + "よう");
    }
    case "adj-i": {
      if (last !== "い") return [];
      // いい se conjugue sur よい : よくない, よかった (いくない n'existe pas).
      const s = dict === "いい" ? "よ" : stem;
      return ["くない", "かった", "くなかった", "くて", "ければ", "く", "です"].map((x) =>
        x === "です" ? dict + x : s + x,
      );
    }
  }
}

/** Classe d'après un token kuromoji (`pos`, `conjugated_type`, `basic_form`). */
export function classOf(t: { pos: string; conjugated_type: string; basic_form: string }): ConjClass | null {
  if (t.pos === "形容詞") return { kind: "adj-i" };
  if (t.pos !== "動詞") return null;
  const ct = t.conjugated_type;
  if (ct.startsWith("一段")) return { kind: "ichidan" };
  if (ct.startsWith("五段")) return { kind: "godan", iku: ct.includes("促音便") && ct.includes("カ行") };
  if (ct.startsWith("サ変")) return { kind: "suru" };
  if (ct.startsWith("カ変")) return { kind: "kuru" };
  return null;
}

/**
 * Classe d'un mot de fiche, lue par kuromoji sur sa graphie : celle de son DERNIER token,
 * qui porte la terminaison (勉強する → する, サ変). Null si ce n'est ni un verbe ni un
 * adjectif en い, ou si le dictionnaire kuromoji est indisponible.
 */
export async function wordClass(surface: string): Promise<ConjClass | null> {
  try {
    const { tokenize } = await import("./tokenizer");
    const tokens = await tokenize(surface);
    const last = tokens[tokens.length - 1];
    return last ? classOf(last) : null;
  } catch {
    return null;
  }
}

/**
 * Forme de dictionnaire (parmi `answers`, déjà normalisées) dont `entry` (normalisée) est
 * une forme conjuguée, ou null. `surface` est la graphie de la fiche, pour la classe.
 */
export async function conjugatedAnswer(
  entry: string,
  answers: string[],
  surface: string,
): Promise<string | null> {
  // Une réponse en 〜する se conjugue en する quelle que soit la graphie : la fiche 勉強
  // porte する dans sa seule lecture (« べんきょう (する) »), kuromoji n'y lit qu'un nom.
  const suru = answers.find(
    (a) => a.endsWith("する") && conjugations(a, { kind: "suru" }).some((f) => normalizeReading(f) === entry),
  );
  if (suru) return suru;
  const cls = await wordClass(surface);
  if (!cls) return null;
  for (const a of answers) {
    if (conjugations(a, cls).some((f) => normalizeReading(f) === entry)) return a;
  }
  return null;
}
