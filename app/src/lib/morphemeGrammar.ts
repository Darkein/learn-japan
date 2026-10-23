// Le point de grammaire d'un mot de la phrase, et la leçon qui l'enseigne. Le Lecteur ne suit
// pas les morphèmes (particules, auxiliaires, verbes non autonomes) en vocabulaire : leur fiche
// dit où ils s'apprennent dans le parcours, plutôt que de promettre une piste « à venir ». Un
// mot de contenu peut aussi porter un point (ある, この, l'adjectif devant un nom).
//
// Déterministe, sans LLM. La FORME d'un point (`grammarForm` : « は », « 〜てもいい »,
// « しか〜ない ») est cherchée dans la phrase autour du mot touché, token par token : une forme
// en plusieurs tokens (ませ|ん|でし|た, て|も|いい) se reconnaît comme un tout, une forme à trou
// (しか〜ない) exige toutes ses pièces dans la phrase. La forme la plus spécifique l'emporte :
// le は de 〜てはいけない n'est pas celui du thème. Une forme portée par plusieurs points (に :
// lieu, moment, destination) les rend tous — le texte seul ne dit pas l'emploi —, sauf quand la
// catégorie du token tranche (から 格助詞 = provenance, 接続助詞 = cause). Quelques points n'ont
// pas de forme écrite (adjectif -い, nom + する, nombres) : des règles sur les catégories IPADIC
// les reconnaissent.

import { getCurriculum, lessonsForGrammar, type CurriculumEntry } from "./curriculum";
import { allGrammarInv, grammarForm } from "./inventory";
import type { KuromojiToken } from "./tokenizer";
import { toRole, type ToRole } from "./toRole";

export interface MorphemePoint {
  id: string;
  name: string;
  /** La leçon qui introduit le point (la première, dans l'ordre du curriculum). */
  lesson?: CurriculumEntry;
}

/**
 * Formes qu'un token porte et que le nom du point ne dit pas, ou dit mal : la て-forme s'écrit
 * aussi で, le volitif う (行こう), 何 et 誰 s'écrivent en kanji. Le と seul passe par `toRole`.
 */
const ALIASES: Record<string, string[]> = {
  "n5-te-form": ["て", "で"],
  "n5-teiru-progressive": ["いる"],
  "n5-te-kudasai": ["ください"],
  "n4-volitional": ["う", "よう"],
  "n5-nani-what": ["何"],
  "n5-dare-who": ["誰"],
  "n4-ichiban": ["一番"],
  "n4-shika-nai": ["しか"],
  "n5-kedo": ["けれど", "けれども", "が"],
  "n5-ndesu": ["のです", "んだ", "のだ"],
};

/** Formes qui REMPLACENT celles du nom : « AはBより » se reconnaît à より seul. */
const FORMS_OVERRIDE: Record<string, string[]> = {
  "n4-yori": ["より"],
  "n4-sonkeigo-verbs": ["いらっしゃる", "おっしゃる", "召し上がる", "めしあがる", "なさる"],
  "n4-kenjougo": ["お〜する", "ご〜する", "参る", "まいる", "申す", "もうす", "いただく"],
  "n4-question-embed": [],
};

/** Points sans forme écrite : reconnus par `RULES`, jamais par leur nom. */
const RULE_ONLY = new Set([
  "n5-suru-verb",
  "n5-iadj-predicate",
  "n5-iadj-attributive",
  "n5-iadj-negative",
  "n5-iadj-past",
  "n5-naadj",
  "n5-numbers",
  "n5-counter-nin",
  "n5-counter-tsu",
  "n4-imperative",
  "n4-kata",
  "n4-question-embed",
  "n4-o-go-nouns",
  "n5-iadj-te",
]);

/**
 * Catégorie IPADIC qu'exige un point reconnu sur UN token (« pos/détail1/détail2 », un champ
 * vide = indifférent) : elle départage から provenance et cause, いる et 〜ている, le volitif
 * う et よう de 〜ようだ. Pas と ni そう : kuromoji s'y trompe, leur contexte les départage
 * (`toRole`, `souKind`).
 */
const POS: Record<string, string> = {
  "n5-te-form": "/接続助詞",
  "n5-kara-from": "/格助詞",
  "n4-kara-cause": "/接続助詞",
  "n5-ga-subject": "/格助詞",
  "n5-de-place": "/格助詞",
  "n5-de-means": "/格助詞",
  "n5-ni-location": "/格助詞",
  "n5-ni-time": "/格助詞",
  "n5-ni-direction": "/格助詞",
  "n5-aru": "動詞/自立",
  "n5-iru": "動詞/自立",
  "n5-teiru-progressive": "/非自立",
  "n5-te-kudasai": "/非自立",
  "n4-volitional": "助動詞",
  "n4-youda": "名詞/非自立",
  "n4-prohibitive": "/終助詞",
  "n4-yori": "/格助詞",
  "n4-shika-nai": "/係助詞",
  "n5-da-copula": "助動詞",
  "n4-shi": "助詞/接続助詞",
  "n5-kedo": "/接続助詞",
  "n5-ya-list": "/並立助詞",
  "n3-bakari": "/副助詞",
  "n5-kosoado-kore": "名詞/代名詞",
  "n5-kosoado-koko": "名詞/代名詞",
  "n5-kosoado-kono": "連体詞",
  "n5-nani-what": "名詞",
  "n5-dare-who": "名詞",
  "n5-doko-where": "名詞",
  "n5-itsu-when": "名詞",
};

/**
 * Points qui sont UN mot : jamais reconnus sur plusieurs tokens (お茶で|も n'est pas でも, 大好きな|ん
 * n'est pas なん).
 */
const ONE_WORD = new Set([
  "n5-demo", "n5-soshite", "n3-sorede", "n3-suruto", "n3-sokode", "n3-tokoroga", "n3-tokorode",
  "n3-tsumari", "n5-kosoado-kore", "n5-kosoado-kono", "n5-kosoado-koko", "n5-nani-what",
  "n5-dare-who", "n5-doko-where", "n5-itsu-when", "n4-ichiban",
]);

/** Ce que doit être le mot d'avant une forme : le な d'interdiction suit un verbe au dictionnaire (行くな), pas か (晴れるかな). */
const PREV_OK: Record<string, (prev?: KuromojiToken) => boolean> = {
  "n4-prohibitive": (prev) => prev?.pos === "動詞" && prev.conjugated_form === "基本形",
  // 行くんです, 寒いんです, 好きなんです : après une forme conjuguée ; 私のです (« le mien ») n'explique rien.
  "n5-ndesu": (prev) => prev?.pos === "動詞" || prev?.pos === "形容詞" || prev?.pos === "助動詞",
};

/** Même chose pour une forme en plusieurs tokens, sur son premier token : そう|です. */
const HEAD_POS: Record<string, string> = {
  "n4-youda": "名詞/非自立",
  // 好きなんです : ん/の nominalisateur ; pas 私のです (« c'est le mien »).
  "n5-ndesu": "名詞/非自立",
};

/**
 * そう d'apparence ou de ouï-dire : kuromoji les confond (疲れていそう sort 特殊, おかしいそう
 * 接尾) ; ce qui précède les départage. Une forme finie (降る, 降った, おかしい) : ouï-dire. Un
 * radical (降り, おいし, 静か) : apparence.
 */
function souKind(tokens: KuromojiToken[], k: number): "n4-sou-appearance" | "n4-sou-hearsay" | null {
  if (tokens[k]?.surface_form !== "そう") return null;
  const prev = tokens[k - 1];
  if (!prev) return null;
  return prev.conjugated_form === "基本形" ? "n4-sou-hearsay" : "n4-sou-appearance";
}

const JAPANESE = /^[぀-ヿ一-鿿]+$/;
/** Une forme se cherche au plus sur ce nombre de tokens. */
const MAX_SPAN = 8;

interface Pattern {
  id: string;
  name: string;
  /** Pièces dans l'ordre ; plusieurs = forme à trou (しか〜ない). */
  pieces: string[];
  /** Spécificité : la forme la plus longue l'emporte. */
  weight: number;
}

/** « 〜あいだ(に) » → « 〜あいだに », « 〜あいだ » ; « お／ご + nom » → « お », « ご〜 ». */
function alternativesOf(name: string): string[] {
  const out: string[] = [];
  for (const alt of grammarForm(name).split(/[/／]/)) {
    const bare = alt
      .trim()
      .replace(/-forme$/, "")
      .replace(/[A-Za-zÀ-ÿ+\-\s…]+/g, "〜");
    const opt = bare.match(/^(.*)[(（]([^)）]*)[)）](.*)$/);
    if (opt) out.push(opt[1] + opt[2] + opt[3], opt[1] + opt[3]);
    else out.push(bare);
  }
  return out;
}

function patternFrom(id: string, name: string, form: string): Pattern | null {
  const pieces = form.split("〜").filter(Boolean);
  if (pieces.length === 0 || !pieces.every((p) => JAPANESE.test(p))) return null;
  return { id, name, pieces, weight: pieces.join("").length };
}

let patterns: Pattern[] | null = null;
let names: Map<string, string> | null = null;

function allPatterns(): Pattern[] {
  if (patterns) return patterns;
  patterns = [];
  names = new Map();
  for (const g of allGrammarInv()) {
    names.set(g.id, g.name);
    if (RULE_ONLY.has(g.id)) continue;
    const forms = new Set([...(FORMS_OVERRIDE[g.id] ?? alternativesOf(g.name)), ...(ALIASES[g.id] ?? [])]);
    for (const f of forms) {
      const p = patternFrom(g.id, g.name, f);
      if (p) patterns.push(p);
    }
  }
  return patterns;
}

/**
 * Les graphies sous lesquelles une pièce paraît dans le texte : て/で et た/だ après un verbe
 * (読んで, 読んだ), よう/う du volitif (行こうと思う), la copule polie ou absente
 * (〜はずです, おいしそう), la négation polie (〜てはいけません, 〜はずがありません).
 */
function spellings(piece: string): string[] {
  const out = new Set([piece]);
  if (piece.startsWith("て")) out.add("で" + piece.slice(1));
  if (piece.startsWith("た")) out.add("だ" + piece.slice(1));
  if (piece.startsWith("よう")) out.add("う" + piece.slice(2));
  if (piece.startsWith("させ")) out.add(piece.slice(1)); // 帰らせてもらう
  if (piece.length > 2 && piece.endsWith("だ")) {
    out.add(piece.slice(0, -1) + "です");
    out.add(piece.slice(0, -1));
  }
  if (piece.length > 2 && piece.endsWith("ない")) {
    out.add(piece.slice(0, -2) + "ません");
    out.add(piece.slice(0, -2) + "ありません");
  }
  if (piece.endsWith("いい")) out.add(piece.slice(0, -2) + "よい");
  return [...out];
}

function matchesPos(token: KuromojiToken, spec: string): boolean {
  const [pos, d1, d2] = spec.split("/");
  return (!pos || token.pos === pos) && (!d1 || token.pos_detail_1 === d1) && (!d2 || token.pos_detail_2 === d2);
}

/** Bornes de la phrase qui contient le token `i` (句点 et sauts de ligne exclus). */
function sentenceAround(tokens: KuromojiToken[], i: number): [number, number] {
  const ends = (t: KuromojiToken) => t.pos_detail_1 === "句点" || t.surface_form.includes("\n");
  let a = i;
  while (a > 0 && !ends(tokens[a - 1])) a--;
  let b = i;
  while (b < tokens.length - 1 && !ends(tokens[b + 1])) b++;
  return [a, b];
}

interface Occurrence {
  start: number;
  end: number;
  /** Lue en で/だ pour て/た (読んで) : seulement derrière un verbe à la forme en ん/い. */
  voiced?: boolean;
  /** Lue sur la forme de base d'un token seul (でし → です) : cède devant une graphie exacte. */
  viaBase: boolean;
}

/**
 * Une pièce qui commence par la terminaison d'un mot — く de l'adjectif (寒くなる), る du verbe
 * au dictionnaire (出かけるところ) — commence DANS ce token : seule sa fin compte.
 */
function headOf(t: KuromojiToken, piece: string): string | null {
  if (piece.startsWith("く") && t.pos === "形容詞" && t.surface_form.endsWith("く")) return "く";
  if (piece.startsWith("る") && t.pos === "動詞" && t.conjugated_form === "基本形" && t.surface_form.endsWith("る"))
    return "る";
  return null;
}

/** Occurrences d'une pièce dans [lo, hi], le dernier token pouvant être lu sur sa forme de base. */
function occurrences(tokens: KuromojiToken[], piece: string, lo: number, hi: number): Occurrence[] {
  const want = new Set(spellings(piece));
  const voiced = new Set([...want].filter((w) => w !== piece && /^[でだ]/.test(w) && /^[てた]/.test(piece)));
  const out: Occurrence[] = [];
  for (let a = lo; a <= hi; a++) {
    const head = headOf(tokens[a], piece);
    if (head && a < hi) {
      let prefix = head;
      for (let b = a + 1; b <= hi && b - a < MAX_SPAN; b++) {
        const t = tokens[b];
        if (want.has(prefix + t.surface_form) || want.has(prefix + t.basic_form))
          out.push({ start: a, end: b, viaBase: false });
        prefix += t.surface_form;
      }
    }
    // Une forme en plusieurs tokens ne commence pas sur un mot autonome : い|つ (いつつ mal
    // découpé) n'est pas いつ.
    const free = (tokens[a].pos === "動詞" || tokens[a].pos === "形容詞") && tokens[a].pos_detail_1 === "自立";
    // 読んで, 読んだ : で/だ derrière la forme 連用タ接続 du verbe ; ailleurs (学生だ) c'est la copule.
    const afterTa = tokens[a - 1]?.conjugated_form === "連用タ接続";
    let prefix = "";
    for (let b = a; b <= hi && b - a < MAX_SPAN; b++) {
      const t = tokens[b];
      if (b > a && free) break;
      const cand = prefix + t.surface_form;
      const base = prefix + t.basic_form;
      if (want.has(cand)) {
        if (!(voiced.has(cand) && !afterTa)) out.push({ start: a, end: b, viaBase: false });
      } else if (t.basic_form !== t.surface_form && want.has(base) && !(voiced.has(base) && !afterTa))
        out.push({ start: a, end: b, viaBase: a === b });
      prefix += t.surface_form;
      if (prefix.length > 12) break;
    }
  }
  return out;
}

interface Match {
  id: string;
  weight: number;
  viaBase: boolean;
}

function patternMatches(tokens: KuromojiToken[], i: number): Match[] {
  const [lo, hi] = sentenceAround(tokens, i);
  const out: Match[] = [];
  for (const p of allPatterns()) {
    // Pièce qui couvre le token, puis les autres pièces dans l'ordre, dans la même phrase.
    p.pieces.forEach((piece, k) => {
      for (const o of occurrences(tokens, piece, lo, hi)) {
        if (o.start > i || o.end < i) continue;
        // La catégorie vaut pour une forme d'un seul tenant (しか seul), pas pour chaque pièce
        // d'une forme à trou (le ない de しか〜ない).
        if (p.pieces.length === 1 && o.start === o.end && POS[p.id] && !matchesPos(tokens[i], POS[p.id])) continue;
        if (o.start < o.end && (ONE_WORD.has(p.id) || (HEAD_POS[p.id] && !matchesPos(tokens[o.start], HEAD_POS[p.id])))) continue;
        if (PREV_OK[p.id] && !PREV_OK[p.id](tokens[o.start - 1])) continue;
        if (p.id.startsWith("n4-sou-") && souKind(tokens, o.start) !== p.id) continue;
        if (!piecesAround(tokens, p.pieces, k, o, lo, hi)) continue;
        out.push({ id: p.id, weight: p.weight, viaBase: o.viaBase });
      }
    });
  }
  return out;
}

function piecesAround(
  tokens: KuromojiToken[],
  pieces: string[],
  k: number,
  o: Occurrence,
  lo: number,
  hi: number,
): boolean {
  let left = o.start - 1;
  for (let j = k - 1; j >= 0; j--) {
    const found = occurrences(tokens, pieces[j], lo, left).filter((x) => x.end <= left);
    if (found.length === 0) return false;
    left = Math.max(...found.map((x) => x.start)) - 1;
  }
  let right = o.end + 1;
  for (let j = k + 1; j < pieces.length; j++) {
    const found = occurrences(tokens, pieces[j], right, hi);
    if (found.length === 0) return false;
    right = Math.min(...found.map((x) => x.end)) + 1;
  }
  return true;
}

/** ください, なさい : la demande polie, pas l'impératif sec (起きろ). */
const POLITE_REQUESTS = new Set(["くださる", "なさる", "いらっしゃる", "おっしゃる"]);

export const QUESTION_WORDS = new Set(["何", "なに", "なん", "誰", "だれ", "どこ", "いつ", "どう", "どれ", "どの", "どちら", "なぜ", "どうして", "いくら", "いくつ"]);

const TO_POINTS: Record<ToRole, string[]> = {
  quote: ["n5-to-quote"],
  and: ["n5-to-and"],
  with: ["n5-to-with"],
  "and-or-with": ["n5-to-and", "n5-to-with"],
  conditional: ["n4-to-conditional"],
};

/** Un point en éclipse un autre sur le même token : le な de 静かな n'est pas la copule. */
const ECLIPSES: Record<string, string[]> = {
  "n5-naadj": ["n5-da-copula"],
  "n4-question-embed": ["n5-ka-question"],
  "n5-iadj-negative": ["n5-nai-negative"],
  "n5-iadj-past": ["n5-ta-past"],
  "n5-iadj-te": ["n5-te-form"],
  "n5-itsu-when": ["n5-iru"],
};

const isNumberKanji = (s: string) => /^[0-9０-９一二三四五六七八九十百千万]+$/.test(s);

/**
 * Les points sans forme écrite, d'après les catégories IPADIC du token et de ses voisins. Ils
 * pèsent plus que toute forme : le な de 静かな est celui de l'adjectif, pas la copule.
 */
function ruleMatches(tokens: KuromojiToken[], i: number): string[] {
  const t = tokens[i];
  const prev = tokens[i - 1];
  const next = tokens[i + 1];
  const ids: string[] = [];
  // La forme en く : négation devant ない, liaison devant て (安くて) ; seule (早く寝る), un adverbe.
  const iadj = (a: KuromojiToken, after?: KuromojiToken): string | null => {
    if (a.conjugated_form.startsWith("連用タ")) return "n5-iadj-past";
    if (a.conjugated_form.startsWith("連用テ")) {
      if (after?.basic_form === "ない") return "n5-iadj-negative";
      return after?.surface_form === "て" ? "n5-iadj-te" : null;
    }
    if (after?.pos === "名詞") return "n5-iadj-attributive";
    return a.conjugated_form === "基本形" ? "n5-iadj-predicate" : null;
  };
  // ない seul (時間がない) n'est pas un adjectif de la leçon -い : c'est la négation.
  if (t.pos === "形容詞" && t.pos_detail_1 === "自立" && t.basic_form !== "ない") {
    const id = iadj(t, next);
    if (id) ids.push(id);
  }
  if (prev?.pos === "形容詞" && prev.pos_detail_1 === "自立") {
    if (t.basic_form === "ない" && prev.conjugated_form.startsWith("連用テ")) ids.push("n5-iadj-negative");
    if (t.basic_form === "た" && prev.conjugated_form.startsWith("連用タ")) ids.push("n5-iadj-past");
    if (t.surface_form === "て" && prev.conjugated_form.startsWith("連用テ")) ids.push("n5-iadj-te");
  }
  const naStem = (a?: KuromojiToken) => a?.pos_detail_1 === "形容動詞語幹";
  const naLink = (a?: KuromojiToken) => a?.pos === "助動詞" && a.surface_form === "な";
  if ((naStem(t) && naLink(next)) || (naLink(t) && naStem(prev))) ids.push("n5-naadj");
  const suruNoun = (a?: KuromojiToken) => a?.pos_detail_1 === "サ変接続";
  const suru = (a?: KuromojiToken) => a?.pos === "動詞" && a.basic_form === "する";
  if ((suruNoun(t) && suru(next)) || (suru(t) && suruNoun(prev))) ids.push("n5-suru-verb");
  if (t.pos_detail_1 === "数") ids.push("n5-numbers");
  if (t.pos_detail_2 === "助数詞" && t.surface_form === "人" && prev?.pos_detail_1 === "数") ids.push("n5-counter-nin");
  if (/^(?:[一二三四五六七八九]|いく|ひと|ふた|みっ|よっ|いつ|むっ|なな|やっ|ここの)つ$/.test(t.surface_form) || (t.surface_form === "つ" && isNumberKanji(prev?.surface_form ?? "")))
    ids.push("n5-counter-tsu");
  // kuromoji coupe les interrogatifs en kana : だれ → だれる, いつ → い|つ (つ, auxiliaire
  // archaïque, ne paraît jamais ailleurs dans un texte moderne).
  if (t.surface_form === "だれ" && t.pos === "動詞") ids.push("n5-dare-who");
  if ((t.surface_form === "い" && next?.surface_form === "つ" && next.pos === "助動詞") || (t.surface_form === "つ" && t.pos === "助動詞" && prev?.surface_form === "い"))
    ids.push("n5-itsu-when");
  if (t.pos === "動詞" && t.pos_detail_1 === "自立" && t.conjugated_form.startsWith("命令") && !POLITE_REQUESTS.has(t.basic_form))
    ids.push("n4-imperative");
  // お茶, ご飯, お子さん : le préfixe de politesse, soudé au nom par kuromoji ou détaché.
  if ((t.pos === "名詞" && /^[おご][\u4e00-\u9fff]/.test(t.surface_form)) || (t.pos === "接頭詞" && next?.pos === "名詞" && /^[おご]$/.test(t.surface_form)))
    ids.push("n4-o-go-nouns");
  // 何を買うか、決めていない : un か qui ne clôt pas la phrase, après un mot interrogatif.
  if (t.pos === "助詞" && t.surface_form === "か" && next && next.pos_detail_1 !== "句点" && next.surface_form !== "？") {
    const [lo] = sentenceAround(tokens, i);
    // 誰か, 何か : collé à l'interrogatif, か fait un indéfini (« quelqu'un », « quelque chose »).
    const indefinite = prev && QUESTION_WORDS.has(prev.surface_form);
    if (!indefinite && tokens.slice(lo, i).some((x) => QUESTION_WORDS.has(x.surface_form))) ids.push("n4-question-embed");
  }
  if (t.pos === "名詞" && t.surface_form.length > 1 && t.surface_form.endsWith("方") && t.reading?.endsWith("カタ"))
    ids.push("n4-kata");
  return ids;
}

/**
 * Les points de grammaire que porte le token `i` de la phrase, chacun avec sa leçon : ceux de
 * la forme la plus spécifique qui le couvre, dans l'ordre du curriculum.
 */
export function grammarPointsAt(tokens: KuromojiToken[], i: number): MorphemePoint[] {
  allPatterns();
  let matches = patternMatches(tokens, i);
  // Une graphie exacte l'emporte sur la forme de base (たら : condition, pas le passé た).
  if (matches.some((m) => !m.viaBase)) matches = matches.filter((m) => !m.viaBase);
  const best = Math.max(0, ...matches.map((m) => m.weight));
  let ids = matches.filter((m) => m.weight === best).map((m) => m.id);
  // と seul : son contexte, pas sa forme (une forme plus longue — によると — garde la main).
  const role = toRole(tokens, i);
  if (role && best <= 1) ids = TO_POINTS[role];
  // Une forme écrite de plusieurs kana (〜くなる, 〜わけがない, ほしい) prime sur les règles de
  // catégorie (adjectif -い) : elle dit ce que le mot fait ici.
  const rules = best >= 3 ? [] : ruleMatches(tokens, i);
  ids = [...rules, ...ids];
  // 誰か, 何か : un indéfini, pas une question.
  if (tokens[i].surface_form === "か" && QUESTION_WORDS.has(tokens[i - 1]?.surface_form ?? ""))
    ids = ids.filter((id) => id !== "n5-ka-question" && id !== "n4-question-embed");
  // 読んだ : le passé, pas la copule.
  if (ids.includes("n5-ta-past")) ids = ids.filter((id) => id !== "n5-da-copula");
  for (const r of rules) ids = ids.filter((id) => !(ECLIPSES[r] ?? []).includes(id));
  const order = new Map(getCurriculum().map((c, k) => [c.id, k]));
  const points = [...new Set(ids)].map((id) => ({
    id,
    name: names?.get(id) ?? id,
    lesson: lessonsForGrammar([id])[0],
  }));
  const rank = (p: MorphemePoint) => (p.lesson ? (order.get(p.lesson.id) ?? Infinity) : Infinity);
  return points.sort((a, b) => rank(a) - rank(b));
}

/** Un token hors de sa phrase : seules ses formes propres comptent. */
export function grammarPointsFor(token: KuromojiToken): MorphemePoint[] {
  return grammarPointsAt([token], 0);
}
