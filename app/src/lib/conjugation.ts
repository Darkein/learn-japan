// Conjugueur déterministe (N5) : dérive les formes ます/て/た/ない (et leurs composées du
// référentiel grammaire) depuis la forme du dictionnaire. Zéro LLM : classes verbales
// résolues par kuromoji (一段 vs 五段 pour les verbes en -る), tables d'okurigana sinon.
//
// Sert les drills de production de l'échauffement : un point de grammaire de conjugaison
// dû est révisé en conjuguant un verbe déjà en rotation SRS, au lieu d'un QCM passif.

import type { TypeExercise } from "./exercise";
import { normalizeReading } from "./kana";
import { tokenize } from "./tokenizer";

/** Couple surface (avec kanji) / lecture (kana) — conjugués en parallèle. */
export interface JaPair {
  surface: string;
  reading: string;
}

export type VerbClass = "ichidan" | "godan" | "suru" | "kuru";

export type ConjForm =
  | "masu"
  | "masen"
  | "mashita"
  | "masendeshita"
  | "te"
  | "tekudasai"
  | "teiru"
  | "ta"
  | "nai";

/** Formes couvertes, liées aux points de grammaire de l'inventaire N5. */
export interface ConjFormDef {
  form: ConjForm;
  grammarId: string;
  /** Complément de consigne : « Mets ce verbe … ». */
  label: string;
}

export const CONJ_FORMS: ConjFormDef[] = [
  { form: "masu", grammarId: "n5-masu-polite", label: "à la forme polie（〜ます）" },
  { form: "masen", grammarId: "n5-masen-negative", label: "à la négation polie（〜ません）" },
  { form: "mashita", grammarId: "n5-mashita-past", label: "au passé poli（〜ました）" },
  { form: "masendeshita", grammarId: "n5-masen-deshita", label: "au passé négatif poli（〜ませんでした）" },
  { form: "te", grammarId: "n5-te-form", label: "à la forme て" },
  { form: "tekudasai", grammarId: "n5-te-kudasai", label: "à la demande polie（〜てください）" },
  { form: "teiru", grammarId: "n5-teiru-progressive", label: "à la forme continue（〜ている）" },
  { form: "ta", grammarId: "n5-ta-past", label: "au passé neutre（〜た）" },
  { form: "nai", grammarId: "n5-nai-negative", label: "à la négation neutre（〜ない）" },
];

const CONJ_FORM_BY_GRAMMAR = new Map(CONJ_FORMS.map((f) => [f.grammarId, f]));

/** Le point de grammaire est-il révisable par un drill de conjugaison ? */
export function isConjugationGrammar(grammarId: string): boolean {
  return CONJ_FORM_BY_GRAMMAR.has(grammarId);
}

// ---------- Tables 五段 (par kana final) -------------------------------------

const GODAN_I: Record<string, string> = {
  う: "い", く: "き", ぐ: "ぎ", す: "し", つ: "ち", ぬ: "に", ぶ: "び", む: "み", る: "り",
};
const GODAN_A: Record<string, string> = {
  う: "わ", く: "か", ぐ: "が", す: "さ", つ: "た", ぬ: "な", ぶ: "ば", む: "ま", る: "ら",
};
const GODAN_TE: Record<string, string> = {
  く: "いて", ぐ: "いで", す: "して", う: "って", つ: "って", る: "って", ぬ: "んで", ぶ: "んで", む: "んで",
};

/** ある (有る/在る) : négation supplétive ない, pas あらない. */
function isAru(v: JaPair): boolean {
  return v.reading === "ある" && ["ある", "有る", "在る"].includes(v.surface);
}

interface Stems {
  /** Base en -ます (連用形). */
  masu: JaPair;
  /** Base en -ない (未然形). */
  nai: JaPair;
  te: JaPair;
  ta: JaPair;
}

function append(p: JaPair, suffix: string): JaPair {
  return { surface: p.surface + suffix, reading: p.reading + suffix };
}

function cutLast(p: JaPair): JaPair {
  return { surface: p.surface.slice(0, -1), reading: p.reading.slice(0, -1) };
}

function stems(v: JaPair, cls: VerbClass): Stems | null {
  if (cls === "ichidan") {
    if (!v.surface.endsWith("る") || !v.reading.endsWith("る")) return null;
    const base = cutLast(v);
    return { masu: base, nai: base, te: append(base, "て"), ta: append(base, "た") };
  }

  if (cls === "godan") {
    const last = v.surface.slice(-1);
    // La forme du dictionnaire finit toujours par le même kana (okurigana) des deux côtés.
    if (last !== v.reading.slice(-1)) return null;
    const i = GODAN_I[last];
    const a = GODAN_A[last];
    let teSuffix = GODAN_TE[last];
    if (!i || !a || !teSuffix) return null;
    // 行く (et composés en 〜いく/〜ゆく) : 促音便 → 行って, pas 行いて.
    if (last === "く" && /[いゆ]く$/.test(v.reading)) teSuffix = "って";
    const base = cutLast(v);
    const te = append(base, teSuffix);
    return {
      masu: append(base, i),
      nai: append(base, a),
      te,
      ta: { surface: te.surface.slice(0, -1) + (teSuffix.endsWith("で") ? "だ" : "た"),
            reading: te.reading.slice(0, -1) + (teSuffix.endsWith("で") ? "だ" : "た") },
    };
  }

  if (cls === "suru") {
    if (!v.surface.endsWith("する") || !v.reading.endsWith("する")) return null;
    const base = { surface: v.surface.slice(0, -2) + "し", reading: v.reading.slice(0, -2) + "し" };
    return { masu: base, nai: base, te: append(base, "て"), ta: append(base, "た") };
  }

  // kuru : lecture irrégulière (き/こ) — la surface 来 ne change pas, la lecture si.
  if (v.reading !== "くる") return null;
  const kanji = v.surface === "来る";
  if (!kanji && v.surface !== "くる") return null;
  const stem = (r: string): JaPair => ({ surface: kanji ? "来" : r, reading: r });
  return {
    masu: stem("き"),
    nai: stem("こ"),
    te: append(stem("き"), "て"),
    ta: append(stem("き"), "た"),
  };
}

/** Conjugue un verbe (surface + lecture) à la forme demandée, ou null si hors modèle. */
export function conjugate(v: JaPair, cls: VerbClass, form: ConjForm): JaPair | null {
  const st = stems(v, cls);
  if (!st) return null;
  switch (form) {
    case "masu": return append(st.masu, "ます");
    case "masen": return append(st.masu, "ません");
    case "mashita": return append(st.masu, "ました");
    case "masendeshita": return append(st.masu, "ませんでした");
    case "te": return st.te;
    case "tekudasai": return append(st.te, "ください");
    case "teiru": return append(st.te, "いる");
    case "ta": return st.ta;
    case "nai":
      if (isAru(v)) return { surface: "ない", reading: "ない" };
      return append(st.nai, "ない");
  }
}

// ---------- Classification ----------------------------------------------------

/** Classe verbale depuis le `conjugated_type` kuromoji (IPADIC), ou null si hors modèle. */
export function classFromType(type: string): VerbClass | null {
  if (type.startsWith("一段")) return "ichidan";
  if (type.startsWith("カ変")) return "kuru";
  if (type.startsWith("サ変")) return "suru";
  // Exclut les 五段 irréguliers (問う→問うて, 下さる→下さい) : hors modèle N5.
  if (type.startsWith("五段") && !type.includes("特殊") && !type.includes("ウ音便")) return "godan";
  return null;
}

/**
 * Détecte si un item de vocabulaire est un verbe conjugable et retourne sa classe.
 * Composés nom+する → suru sans tokenizer ; sinon kuromoji tranche (一段 vs 五段 pour
 * les verbes en -る). Tokenizer indisponible (tests, dico pas chargé) → null.
 */
export async function detectVerbClass(v: JaPair): Promise<VerbClass | null> {
  if (v.surface.endsWith("する") && v.reading.endsWith("する")) return "suru";
  if (v.reading === "くる" && (v.surface === "来る" || v.surface === "くる")) return "kuru";
  try {
    const tokens = await tokenize(v.surface);
    if (tokens.length !== 1) return null;
    const t = tokens[0];
    if (t.pos !== "動詞" || t.basic_form !== v.surface) return null;
    return classFromType(t.conjugated_type);
  } catch {
    return null;
  }
}

// ---------- Drill (exercice de production) -------------------------------------

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Combien de candidats-verbes on tente de classifier avant d'abandonner le drill. */
const DETECT_ATTEMPTS = 8;

export interface DrillVerb {
  surface: string;
  reading: string;
  meaning: string;
}

/**
 * Drill de conjugaison pour un point de grammaire (s'il correspond à une forme couverte) :
 * pioche un verbe dans le pool (mots déjà en rotation SRS), demande la forme en saisie.
 * Note la MÊME carte FSRS que le point de grammaire → la règle est révisée en production.
 * Retourne null si le point n'est pas une forme couverte ou si aucun verbe ne convient.
 */
export async function conjugationExercise(
  g: { id: string; name: string; rule: string },
  verbs: DrillVerb[],
  due: number,
): Promise<TypeExercise | null> {
  const def = CONJ_FORM_BY_GRAMMAR.get(g.id);
  if (!def) return null;

  let attempts = 0;
  for (const v of shuffle(verbs)) {
    if (attempts >= DETECT_ATTEMPTS) break;
    attempts++;
    const cls = await detectVerbClass(v);
    if (!cls) continue;
    const conj = conjugate(v, cls, def.form);
    if (!conj) continue;
    const hasMeaning = !!v.meaning && v.meaning !== "—";
    return {
      mode: "type",
      key: `conj:${g.id}:${v.surface}`,
      track: "grammar",
      id: g.id,
      front: hasMeaning ? `${v.surface}（${v.meaning}）` : v.surface,
      prompt: `Mets ce verbe ${def.label}`,
      answers: [...new Set([normalizeReading(conj.surface), normalizeReading(conj.reading)])],
      back: `${conj.surface}（${conj.reading}）`,
      due,
      seedName: g.name,
      seedRule: g.rule,
    };
  }
  return null;
}
