// Assemblage PUR du script podcast (SPEC §11) : cadrage (cours) parlé → quiz variés
// (français ↔ japonais, avec un blanc) → histoire(s) (annonce du titre puis paires
// phrase JP + traduction FR) → transition de fin.
//
// Les passages mêlant les deux langues (prose FR avec japonais inline, paires JA+FR)
// deviennent UN segment portant `parts` : une seule synthèse multi-voix (SSML <voice>)
// au lieu de fragments coupés à chaque bascule de langue.
//
// Déterministe, zéro effet (pas de LLM, pas d'IndexedDB) → testable en Node. La partie
// « effets » (traduction LLM) vit dans lib/podcast.ts.

import { TTS_SSML_BUDGET_BYTES, TTS_SSML_PART_WRAP_BYTES, type TtsLang } from "./config";
import type { ComprehensionQuestion } from "./genClient";
import { isKana, isKanji, splitJaSentences, stripFurigana } from "./kana";
import { parseBlocks, type Block } from "./lessonMarkdown";
import type { PlayerSentence } from "./tts";
import type { TtsPart } from "./ttsClient";
import type { VocabEntry } from "./curriculum";
import type { Lesson } from "./lessons";

// Ré-export : `stripFurigana` vit désormais dans kana.ts (lib/lessonMarkdown.ts l'importe, et
// ce module importe parseBlocks — le passer par kana.ts casse le cycle). Les appelants
// historiques continuent de le trouver ici.
export { stripFurigana };

export type PodcastChapter = "cours" | "quiz" | "histoire" | "comprehension";

export interface PodcastSegment {
  id: string;
  chapter: PodcastChapter;
  lang: "fr" | "ja";
  /** Texte à synthétiser. */
  text: string;
  /** Blanc (ms) APRÈS ce segment — ex. le silence de réponse d'un quiz. */
  pauseAfterMs?: number;
  /** Libellé court pour la tracklist (sinon dérivé du texte). */
  label?: string;
  /** Surfaces des tokens de la phrase (histoire) : active la synthèse avec timepoints. */
  tokens?: string[];
  /** Index GLOBAL du 1er token de la phrase (surlignage). */
  baseTokenIndex?: number;
  /** Fragments voicés (segment mixte FR/JA) : une seule synthèse multi-voix. */
  parts?: TtsPart[];
  /**
   * Index du bloc AFFICHÉ (lib/lessonMarkdown.parseBlocks) dont ce segment est issu —
   * chapitre « cours » seulement. Donne à CourseDetail le bloc à surligner SANS recherche
   * floue de texte : les amorces parlées (« Pour résumer. ») et les rangées de tableau
   * linéarisées n'existent pas telles quelles dans le Markdown, donc `findBlockForSegment`
   * ne saurait pas les retrouver. Toujours l'index d'un bloc de PREMIER niveau (le rendu ne
   * surligne que ceux-là) : les segments issus d'un encadré portent l'index de l'encadré.
   */
  blockIndex?: number;
  /** Id de l'histoire à laquelle ce segment appartient (surlignage Reader, suivi CourseDetail). */
  storyId?: string;
}

/** Fragments voicés d'un segment : ses `parts` s'il est mixte, sinon son texte entier. */
export function segmentParts(seg: Pick<PodcastSegment, "lang" | "text" | "parts">): TtsPart[] {
  return seg.parts ?? [{ lang: seg.lang, text: seg.text }];
}

// ---------- Tracklist (navigation par élément) --------------------------------

/** Entrée de tracklist : premier segment d'un élément (label distinct) et son index. */
export interface TrackEntry {
  seg: PodcastSegment;
  i: number;
}

/**
 * Tracklist compacte d'une piste : un élément par label distinct (labels consécutifs
 * identiques fusionnés — ex. les segments d'un même quiz). Les segments sans label sont
 * ignorés. C'est la granularité de navigation précédent/suivant, partagée entre la barre
 * du lecteur (ui/PodcastPlayer.tsx) et les commandes média OS (ui/usePodcastPlayer.tsx).
 */
export function trackEntries(segments: PodcastSegment[]): TrackEntry[] {
  const tracks: TrackEntry[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.label) continue;
    const prev = tracks[tracks.length - 1];
    if (prev && prev.seg.label === seg.label && prev.seg.chapter === seg.chapter) continue;
    tracks.push({ seg, i });
  }
  return tracks;
}

/** Élément actif : dernier élément dont l'index segment ≤ position courante (-1 si vide). */
export function activeTrackIndex(tracks: TrackEntry[], segIndex: number): number {
  return tracks.length ? tracks.reduce((found, t, ti) => (t.i <= segIndex ? ti : found), 0) : -1;
}

/** Segment avant attribution de l'id global (assigné en fin d'assemblage). */
type RawSegment = Omit<PodcastSegment, "id">;

/**
 * Applique `speechText` au texte PARLÉ d'un segment, quel que soit son chapitre. Le chapitre
 * « cours » y passe déjà via `emit`, mais pas les quiz, dont deux modèles sur trois finissent
 * par « ». » — le point y restait orphelin et la synthèse le VERBALISAIT, comme dans le cours.
 * `speechText` est idempotent : repasser sur des `parts` déjà normalisées ne change rien.
 */
function normalizeSpoken(seg: RawSegment): RawSegment {
  const before = segmentParts(seg);
  const parts = before.map((p) => ({ ...p, text: speechText(p.text) }));
  return parts.some((p, i) => p.text !== before[i].text) ? { ...seg, parts } : seg;
}

/** Durée du blanc de réponse d'un quiz (« comment dit-on chat ? » → 5 s → « neko »). */
export const QUIZ_PAUSE_MS = 5000;

/** Blanc de réflexion d'une question de compréhension (4 options à soupeser → plus long). */
export const COMP_PAUSE_MS = 8000;

/**
 * Version du format de pack. À incrémenter dès que la SORTIE de `buildPodcastScript` change,
 * de quelque façon que ce soit : découpage des segments, amorces, pauses, routage des voix,
 * ou simple normalisation du texte parlé (`speechText`, `speakCitedParticle`).
 *
 * Le piège : le pack persiste les `parts` de chaque segment, donc le texte DÉJÀ normalisé pour
 * la synthèse. Un pack en cache n'est réassemblé que si cette version change ou si la matière
 * de la leçon bouge (`packFingerprint`) — jamais parce que le code d'assemblage a changé. Une
 * correction livrée sans bump n'atteint donc PAS les leçons déjà écoutées : elles rejouent
 * l'ancien texte indéfiniment. C'est arrivé pour le retrait des guillemets (v10).
 */
export const PACK_VERSION = 13;

// ---------- Français pur (anti double-lecture) ------------------------------

// Plages japonaises : hiragana, katakana, katakana demi-largeur, CJK unifiés.
const JA_CHARS = /[぀-ヿｦ-ﾟ㐀-鿿]/;

/** Vrai si le texte contient au moins un caractère japonais. */
export function containsJa(s: string): boolean {
  return JA_CHARS.test(s);
}

/**
 * Nettoie une traduction française pour la lecture vocale : retire les gloses japonaises
 * (mot japonais / romaji entre parenthèses) et tout caractère japonais résiduel, afin que
 * la voix française ne répète pas un mot déjà prononcé en japonais (ex. « le chat (猫, neko) »).
 */
export function cleanFrench(s: string): string {
  return s
    // Parenthèses contenant du japonais → supprimées en entier (« (猫, neko) »).
    .replace(/[（(][^)）]*[぀-ヿｦ-ﾟ㐀-鿿][^)）]*[)）]/g, "")
    // Caractères japonais isolés résiduels.
    .replace(new RegExp(JA_CHARS.source, "g"), "")
    // Parenthèses vidées et espaces parasites avant ponctuation.
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/\s+([,.;:!?»])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------- Quiz de vocabulaire (déterministe, varié) -----------------------

/** Forme japonaise à PRONONCER : le yomi (kana) si présent, jamais un kanji brut. */
function spokenJa(v: VocabEntry): string {
  return v.yomi && v.yomi !== v.ja ? v.yomi : v.ja;
}

/**
 * Construit les segments de quiz à partir du vocabulaire de la leçon. On alterne les
 * modèles pour la variété : production (FR→JP), compréhension (JP→FR), et une variante de
 * production. Chaque question est suivie d'un blanc (`QUIZ_PAUSE_MS`), puis de la réponse.
 */
export function buildVocabQuizzes(vocab: VocabEntry[]): RawSegment[] {
  const segs: RawSegment[] = [];
  vocab.forEach((v, idx) => {
    const ja = spokenJa(v);
    const label = "Quiz";
    switch (idx % 3) {
      case 0: // production FR → JP
        segs.push({ chapter: "quiz", lang: "fr", text: `Comment dit-on « ${v.fr} » en japonais ?`, pauseAfterMs: QUIZ_PAUSE_MS, label });
        segs.push({ chapter: "quiz", lang: "ja", text: ja });
        break;
      case 1: // compréhension JP → FR : amorce FR + mot japonais lus d'une traite, puis réponse FR
        segs.push({
          chapter: "quiz",
          lang: "fr",
          text: `Que veut dire ce mot ? ${ja}`,
          parts: [
            { lang: "fr", text: "Que veut dire ce mot ? " },
            { lang: "ja", text: ja },
          ],
          pauseAfterMs: QUIZ_PAUSE_MS,
          label,
        });
        segs.push({ chapter: "quiz", lang: "fr", text: `Cela signifie « ${v.fr} ».` });
        break;
      default: // production, autre formulation
        segs.push({ chapter: "quiz", lang: "fr", text: `Traduisez en japonais : « ${v.fr} ».`, pauseAfterMs: QUIZ_PAUSE_MS, label });
        segs.push({ chapter: "quiz", lang: "ja", text: ja });
        break;
    }
  });
  return segs;
}

// ---------- Quiz de compréhension (audio, passif) ---------------------------

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Segments audio d'un QCM de compréhension (LLM) : intro, puis par question l'énoncé,
 * les options « A : … », « B : … »…, un blanc de réflexion (`COMP_PAUSE_MS`) après la
 * dernière option, et l'annonce de la bonne réponse. Tout en français (mode voiture,
 * passif : pas de saisie → pas de SRS ici, comme le quiz vocab).
 */
export function buildComprehensionAudio(questions: ComprehensionQuestion[]): RawSegment[] {
  if (questions.length === 0) return [];
  const segs: RawSegment[] = [
    { chapter: "comprehension", lang: "fr", text: "Petit quiz de compréhension sur l'histoire.", label: "Compréhension" },
  ];
  questions.forEach((q, qi) => {
    segs.push({ chapter: "comprehension", lang: "fr", text: `Question ${qi + 1}. ${q.question}`, label: `Question ${qi + 1}` });
    q.options.forEach((opt, oi) => {
      const last = oi === q.options.length - 1;
      segs.push({
        chapter: "comprehension",
        lang: "fr",
        text: `${OPTION_LETTERS[oi] ?? oi + 1} : ${opt}`,
        ...(last ? { pauseAfterMs: COMP_PAUSE_MS } : {}),
      });
    });
    const letter = OPTION_LETTERS[q.answerIndex] ?? String(q.answerIndex + 1);
    segs.push({
      chapter: "comprehension",
      lang: "fr",
      text: `Bonne réponse : ${letter}. ${q.options[q.answerIndex]}`,
    });
  });
  return segs;
}

// ---------- Assemblage du script --------------------------------------------

/** Allège un paragraphe Markdown pour la lecture vocale (retire **gras**, #, etc.). */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vrai si la LIGNE est une phrase japonaise (à dominante kana/kanji), par opposition à une
 * ligne française qui ne contiendrait qu'un mot japonais inline (ex. « La copule です … »).
 * Sert à router la voix TTS : seules les lignes à dominante JP passent en voix japonaise.
 */
function isJapaneseLine(s: string): boolean {
  let ja = 0;
  let latin = 0;
  for (const ch of s) {
    if (isKana(ch) || isKanji(ch)) ja++;
    else if (/[A-Za-zÀ-ÿ]/.test(ch)) latin++;
  }
  return ja > 0 && ja >= latin;
}

const utf8 = new TextEncoder();

/** Budget réel du TEXTE d'un fragment, une fois retiré le coût de son enrobage SSML. */
const RUN_BUDGET_BYTES = TTS_SSML_BUDGET_BYTES - TTS_SSML_PART_WRAP_BYTES;

// Frontières de découpe d'un fragment trop long, de la plus naturelle à la dernière chance.
const SENTENCE_SPLIT = /(?<=[.!?…。！？])\s*/;
const CLAUSE_SPLIT = /(?<=[,、;:，])\s*/;

/**
 * Scinde UN fragment qui excède à lui seul le budget SSML. `splitByBudget` ne coupe qu'entre
 * fragments : une longue ligne japonaise pure (un seul fragment) lui échappait entièrement et
 * partait telle quelle au Worker, qui refusait le SSML — et segmentPlayer coupait alors toute
 * la lecture après sa relance unique. On coupe d'abord aux fins de phrase, puis aux virgules,
 * et en dernier recours au caractère : la lecture reste possible dans tous les cas.
 */
function splitOversizedRun(run: TtsPart): TtsPart[] {
  if (utf8.encode(run.text).length <= RUN_BUDGET_BYTES) return [run];
  const pack = (pieces: string[]): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const piece of pieces) {
      if (cur && utf8.encode(cur + piece).length > RUN_BUDGET_BYTES) {
        out.push(cur);
        cur = "";
      }
      cur += piece;
    }
    if (cur) out.push(cur);
    return out;
  };
  const byChar = (s: string): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const ch of s) {
      if (utf8.encode(cur + ch).length > RUN_BUDGET_BYTES) {
        out.push(cur);
        cur = "";
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const chunks = pack(run.text.split(SENTENCE_SPLIT))
    .flatMap((c) => (utf8.encode(c).length > RUN_BUDGET_BYTES ? pack(c.split(CLAUSE_SPLIT)) : [c]))
    .flatMap((c) => (utf8.encode(c).length > RUN_BUDGET_BYTES ? byChar(c) : [c]));
  return chunks.filter((t) => t.trim()).map((text) => ({ lang: run.lang, text }));
}

/** Scinde une suite de fragments en groupes tenant chacun dans le budget SSML (config.ts). */
function splitByBudget(runs: TtsPart[]): TtsPart[][] {
  const groups: TtsPart[][] = [];
  let cur: TtsPart[] = [];
  let bytes = 0;
  for (const run of runs) {
    const cost = utf8.encode(run.text).length + TTS_SSML_PART_WRAP_BYTES;
    if (cur.length && bytes + cost > TTS_SSML_BUDGET_BYTES) {
      groups.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(run);
    bytes += cost;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// Ponctuation de fin de phrase de la prose (FR + JA) : frontière naturelle de segment.
const PROSE_SENTENCE_END = new Set([".", "!", "?", "…", "。", "！", "？"]);

// Délimiteurs qui appartiennent ENCORE à la phrase qui s'achève : couper avant eux laisse un
// guillemet fermant orphelin en tête du segment suivant. Les apostrophes en sont exclues —
// en français elles vivent au milieu des mots (« l'eau »).
const CLOSING_DELIMS = new Set(["»", "”", "\"", ")", "]", "}", "、", "，", "。"]);

/** Au moins une lettre ou un chiffre : sans ça, il n'y a rien à PRONONCER. */
const SPEAKABLE = /[\p{L}\p{N}]/u;

// Ponctuation japonaise : elle appartient à la voix japonaise. Laissée au français, un 。
// final se détacherait de la phrase qu'il termine.
// `…` en est volontairement absent : il sert autant au français (« en ce qui concerne… »).
const JA_PUNCT = new Set(["。", "、", "！", "？", "「", "」", "『", "』", "・", "〜", "（", "）"]);

/** Langue d'un caractère, ou `null` s'il est NEUTRE (espace, ponctuation latine, symbole). */
function charLang(ch: string): "ja" | "fr" | null {
  if (isKana(ch) || isKanji(ch) || JA_PUNCT.has(ch)) return "ja";
  return /[A-Za-zÀ-ÿ0-9]/.test(ch) ? "fr" : null;
}

/** Vrai si le caractère peut OUVRIR une phrase (majuscule, chiffre, ouvrant, japonais). */
function startsSentence(ch: string): boolean {
  return /[A-ZÀ-ÖØ-Þ0-9«“"([]/.test(ch) || isKana(ch) || isKanji(ch);
}

/**
 * Vrai si la phrase en cours (`buf`) s'achève VRAIMENT en `i`. Le test naïf « ponctuation
 * finale suivie d'un blanc » se trompe deux fois sur une citation :
 *
 *   signifie « en ce qui concerne… », « quant à… ».
 *
 * il coupait sur le premier « … » (suivi d'une espace, puis du guillemet fermant), donnant à
 * la voix une intonation de fin en plein milieu, puis un segment de PURE ponctuation — « ». »
 * — que la synthèse prononce « point », faute de mot où l'accrocher.
 *
 * Deux garde-fous : la grappe de ponctuation doit être terminée (on ne coupe pas avant le
 * guillemet fermant ni avant le point final), et ce qui suit doit ressembler à un vrai début
 * de phrase. Une ponctuation finale suivie d'une virgule ne ferme donc plus rien.
 */
function endsSentence(buf: string, chars: string[], i: number): boolean {
  const next = chars[i + 1];
  // Grappe non terminée : la ponctuation continue au caractère suivant.
  if (next !== undefined && (PROSE_SENTENCE_END.has(next) || CLOSING_DELIMS.has(next))) return false;
  // La phrase doit s'achever sur une ponctuation finale, ses fermants éventuels compris.
  if (!/[.!?…。！？][»”")\]\s]*$/.test(buf)) return false;
  if (next === undefined) return true; // fin du texte
  let j = i + 1;
  while (j < chars.length && /\s/.test(chars[j])) j++;
  // Un blanc au moins (sinon « fin.Suite » n'est pas une frontière), et un vrai début derrière.
  return j > i + 1 && j < chars.length && startsSentence(chars[j]);
}

/**
 * Particules dont la GRAPHIE et la PRONONCIATION diffèrent. Citée seule (« la particule は »),
 * une particule n'a pas de contexte : la voix japonaise lit alors le kana tel qu'il s'écrit et
 * dit « ha » — au moment précis où la leçon enseigne qu'il se prononce « wa ». On lui envoie
 * donc le kana qui SONNE juste. En phrase, は est déjà correctement lu : rien à corriger.
 */
const CITED_PARTICLE_READING: Record<string, string> = { は: "わ", へ: "え", を: "お" };

/**
 * Réécrit un fragment réduit à une particule citée. Appliqué au seul `parts[].text` — jamais
 * au `text` du segment, qui doit rester le texte de la LEÇON : c'est lui que le suivi de
 * lecture compare au Markdown affiché, et lui qu'affiche la carte « en cours de lecture ».
 */
function speakCitedParticle(run: TtsPart): TtsPart {
  if (run.lang !== "ja") return run;
  const reading = CITED_PARTICLE_READING[run.text.trim()];
  return reading ? { ...run, text: run.text.replace(run.text.trim(), reading) } : run;
}

/**
 * Texte à PRONONCER d'un fragment. Les guillemets français ne s'entendent pas — mais ils
 * cassent la ponctuation qui les suit : dans « quant à… ». , la synthèse ne sait à quel mot
 * rattacher le point final et le VERBALISE (« point »). On les retire donc du texte parlé, en
 * recollant la ponctuation restée orpheline. Le `text` du segment, lui, garde la typographie
 * de la leçon : c'est lui qui s'affiche et qui sert au suivi de lecture.
 */
function speechText(s: string): string {
  return s
    // Chaque guillemet devient une VIRGULE : elle ne se prononce pas mais impose une
    // respiration, là où le simple retrait collait la citation au reste de la phrase. Sur une
    // apposition (« le mot, chat, se dit neko ») c'est d'ailleurs la ponctuation correcte.
    // Les espaces adjacentes sont absorbées : aucune « , » n'apparaît précédée d'un blanc.
    .replace(/\s*[«»“”„‟]\s*/g, ", ")
    // Virgules devenues surnuméraires (« … », « … » en donnait trois de suite).
    .replace(/(?:,\s*){2,}/g, ", ")
    // Une virgule n'a rien à faire devant une ponctuation plus forte, ni juste après elle.
    // « … » en est exclu des deux côtés : après des points de suspension, la virgule est
    // légitime (« en ce qui concerne…, quant à… ») et c'est elle qui porte la respiration.
    .replace(/,\s*(?=[.;:!?])/g, "")
    .replace(/([.;:!?])\s*,\s*/g, "$1 ")
    .replace(/…\s*\./g, "…") // « … ». → un seul terminateur
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ");
}

/** Options d'émission d'un segment de cours (cf. `emit`). */
interface EmitOpts {
  label: string;
  /** Index du bloc AFFICHÉ dont ce segment est issu (surlignage du cours). */
  blockIndex?: number;
}

/**
 * Ferme un énoncé AUTONOME dépourvu de ponctuation finale — titre, puce, rangée de tableau.
 * Sans point, la synthèse laisse la phrase en suspens : le titre s'entend comme s'il manquait
 * quelque chose derrière, et le blanc qui suit ne referme rien. La ponctuation est ajoutée au
 * seul texte PARLÉ (`parts`) : `text` reste le titre de la leçon, qui s'affiche tel quel.
 */
function closeUtterance(segs: RawSegment[]): RawSegment[] {
  if (!segs.length) return segs;
  const last = segs[segs.length - 1];
  const parts = segmentParts(last);
  const tail = parts[parts.length - 1];
  const trimmed = tail?.text.trimEnd() ?? "";
  // Déjà ponctué, ou en attente d'une suite (« : », « , ») : on ne touche à rien.
  if (!trimmed || /[.!?…。！？:;,、]$/.test(trimmed)) return segs;
  const closed = { ...tail, text: `${trimmed}${tail.lang === "ja" ? "。" : "."}` };
  return [...segs.slice(0, -1), { ...last, parts: [...parts.slice(0, -1), closed] }];
}

/**
 * Pose le blanc de fin sur le DERNIER segment d'une suite — les autres s'enchaînent sans
 * blanc. Seul mécanisme de pause du chapitre : un blanc ne tombe donc jamais au milieu d'un
 * énoncé scindé par le budget SSML, ni entre deux morceaux d'une même unité parlée.
 */
function withTrailingPause(segs: RawSegment[], pauseAfterMs: number): RawSegment[] {
  if (!segs.length) return segs;
  return [...segs.slice(0, -1), { ...segs[segs.length - 1], pauseAfterMs }];
}

/**
 * Entonnoir UNIQUE de production des segments de cours : prose, phrase d'exemple, rangée de
 * tableau, puce, amorce — tout passe par ici. C'est ce qui garantit en UN seul endroit les
 * trois invariants du chapitre :
 *  - le budget SSML est respecté (un énoncé trop long fait échouer la synthèse, et
 *    segmentPlayer coupe alors TOUTE la lecture après une relance unique) ;
 *  - aucun énoncé vide, ni réduit à de la PONCTUATION (le Worker rejette le premier ; la
 *    synthèse verbalise le second — un « ». » esseulé se prononce « point ») ;
 *  - le blanc éventuel tombe APRÈS le dernier groupe, jamais au milieu d'un énoncé scindé.
 *
 * Fragments fusionnés en `parts` si le groupe en compte ≥ 2, segment simple sinon.
 */
/**
 * Langue AFFICHÉE d'un segment. Le choix de la voix est plus fin que celui de la langue
 * (`frExample` reste du français) : l'UI et le routage de la prose n'ont pas à le savoir.
 */
function displayLang(lang: TtsLang): "fr" | "ja" {
  return lang === "ja" ? "ja" : "fr";
}

function emit(runs: TtsPart[], opts: EmitOpts): RawSegment[] {
  const kept = runs.filter((r) => r.text.trim()).flatMap(splitOversizedRun);
  if (!kept.length) return [];
  const groups = splitByBudget(kept).filter((g) => g.some((r) => SPEAKABLE.test(r.text)));
  return groups.map((group) => {
    // Ce qui est PRONONCÉ peut différer de ce qui est ÉCRIT (particule citée) : `text` reste
    // le texte de la leçon, `parts` porte la version parlée.
    const spoken = group.map(speakCitedParticle).map((r) => ({ ...r, text: speechText(r.text) }));
    const rewritten = spoken.some((r, i) => r.text !== group[i].text);
    return {
      chapter: "cours" as const,
      ...(group.length === 1
        ? { lang: displayLang(group[0].lang), text: group[0].text.trim(), ...(rewritten ? { parts: spoken } : {}) }
        : { lang: "fr" as const, text: group.map((r) => r.text).join("").trim(), parts: spoken }),
      label: opts.label,
      ...(opts.blockIndex != null ? { blockIndex: opts.blockIndex } : {}),
    };
  });
}

/**
 * Découpe la prose FRANÇAISE contenant des mots japonais inline (ex. « La particule は
 * marque le thème ») en fragments voicés — le texte latin en voix française, le japonais
 * en voix japonaise, sinon la voix française écorche le japonais (は lu « ka ») —
 * fusionnés en UN segment `parts` PAR PHRASE, lu d'une traite. L'unité parlée reste la
 * phrase : la première synthèse est courte (le son démarre vite), sans réintroduire de
 * coupure au milieu d'une phrase. Le furigana entre parenthèses est d'abord retiré ;
 * l'espacement reste collé au fragment en cours, donc le SSML reconstitue le texte à
 * l'identique.
 *
 * Les caractères NEUTRES (espaces, « + », parenthèses…) ne sont pas rattachés à la langue en
 * cours : ils reviennent au français, sauf lorsqu'ils sont encadrés de japonais des DEUX
 * côtés. Sans cette règle, « thème は + objet » plaçait « + » dans le fragment japonais, que
 * la voix lisait « プラス » — et « は », n'étant plus seul dans son fragment, échappait à la
 * correction de prononciation.
 */
function proseSegments(text: string, opts: EmitOpts): RawSegment[] {
  const clean = stripFurigana(stripMarkdown(text));
  if (!clean) return [];
  const out: RawSegment[] = [];
  let runs: TtsPart[] = [];
  let buf = "";
  let pending = ""; // neutres en attente : leur langue dépend de ce qui SUIT
  let lang: "fr" | "ja" | null = null;
  const flushRun = () => {
    if (buf.trim()) runs.push({ lang: lang === "ja" ? "ja" : "fr", text: buf });
    buf = "";
  };
  const flushSentence = () => {
    buf += pending; // les neutres de fin closent la phrase avec la voix en cours
    pending = "";
    flushRun();
    if (runs.length) out.push(...emit(runs, opts));
    runs = [];
    lang = null;
  };
  const chars = [...clean];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cls = charLang(ch);
    if (!cls) {
      pending += ch;
    } else if (cls === lang) {
      buf += pending + ch; // neutres entourés de la MÊME langue : ils lui appartiennent
      pending = "";
    } else if (cls === "fr") {
      flushRun(); // bascule JA → FR : les neutres partent avec le français
      lang = "fr";
      buf = pending + ch;
      pending = "";
    } else {
      buf += pending; // bascule FR → JA (ou début de texte) : les neutres restent français
      pending = "";
      flushRun();
      lang = "ja";
      buf = ch;
    }
    if (endsSentence(buf + pending, chars, i)) flushSentence();
  }
  flushSentence();
  return out;
}

// ---------- Rythme parlé du cours -------------------------------------------
//
// Le lecteur appond tout dans un flux continu : deux segments consécutifs s'enchaînent SANS
// blanc (cf. lib/segmentPlayer.ts). Les respirations du cours sont donc entièrement décrites
// ici. Volontairement courtes : chaque blanc est une région où la barre de progression se
// fige, et une leçon en compte beaucoup.

/** Après une phrase japonaise d'exemple, avant sa traduction : le temps de la saisir. */
export const EXAMPLE_JA_PAUSE_MS = 450;
/** Après la traduction : la frontière entre deux exemples. */
export const EXAMPLE_PAIR_PAUSE_MS = 750;
/** Entre deux éléments d'une même énumération (puce, rangée de tableau). */
export const ITEM_PAUSE_MS = 400;
/** Après un titre de section : on change de sujet. */
export const SECTION_PAUSE_MS = 800;
/** Après un bloc structuré (encadré, exemple, tableau, liste) : on referme la parenthèse. */
export const BLOCK_PAUSE_MS = 700;

/**
 * Amorces parlées des encadrés. Volontairement réduites au strict nécessaire : à l'écran un
 * `:::pitfall` a un cadre rouge, à l'oreille il n'a RIEN — sa phrase japonaise fautive
 * s'entend exactement comme un bon exemple, et s'apprend comme tel. `info` et `warning`
 * n'en reçoivent pas : leur contenu est vrai, la pause suffit à les détacher.
 *
 * L'amorce du piège ne porte pas de blanc : elle enchaîne sur la phrase fautive, comme une
 * seule phrase — ce que le flux continu permet sans avoir à fusionner les deux énoncés.
 */
const CALLOUT_LEAD_IN: Record<Extract<Block, { kind: "callout" }>["ctype"], string> = {
  pitfall: "On entend souvent, à tort :",
  summary: "Pour résumer.",
  info: "",
  warning: "",
};

/**
 * Une ligne. La voix japonaise ne prend la ligne ENTIÈRE que si elle ne contient aucun mot
 * latin : « On dit 日本語ができます。 » compte plus de caractères japonais que latins, mais
 * confier le tout à la voix japonaise lui fait écorcher « On dit ». Dès qu'il y a du
 * français, on repasse par le découpage en fragments voicés.
 */
function lineSegments(line: string, opts: EmitOpts): RawSegment[] {
  const clean = stripFurigana(stripMarkdown(line));
  const pureJa = /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(clean) && !/[A-Za-zÀ-ÿ]/.test(clean);
  return pureJa ? emit([{ lang: "ja", text: clean }], opts) : proseSegments(clean, opts);
}

/**
 * Lignes d'un paragraphe. Bi-branche héritée de l'ancien assembleur, et toujours nécessaire :
 * un paragraphe purement français est recollé en un seul texte (une phrase coupée par un
 * retour à la ligne mou reste une phrase), tandis qu'un bloc contenant du japonais est traité
 * ligne à ligne (exemple japonais écrit hors `:::example`).
 */
function proseLines(lines: string[], opts: EmitOpts): RawSegment[] {
  const clean = lines.map((l) => stripFurigana(stripMarkdown(l))).filter(Boolean);
  if (!clean.length) return [];
  if (!clean.some(isJapaneseLine)) return proseSegments(clean.join(" "), opts);
  return clean.flatMap((line) => lineSegments(line, opts));
}

/**
 * Tableau linéarisé : une rangée = une phrase parlée. Lu tel quel (« Forme Exemple Neutre する
 * Poli します »), un tableau de conjugaison est une bouillie — c'est le pire cas du chapitre.
 * La 1re cellule sert d'étiquette de rangée ; à partir de 3 colonnes, l'en-tête est rappelé
 * devant chaque valeur, sans quoi on ne sait plus de quelle colonne on parle. La ligne
 * d'en-tête elle-même n'est pas prononcée : c'est de la mise en page.
 */
function tableSegments(head: string[], rows: string[][], opts: EmitOpts): RawSegment[] {
  const titles = head.map((h) => stripMarkdown(h));
  const spoken = rows.map((row) => {
    const cells = row.map((c) => stripMarkdown(c)).filter((c) => c);
    if (!cells.length) return "";
    const [first, ...rest] = cells;
    if (!rest.length) return first;
    // Séparateurs sans ponctuation FINALE : la rangée reste UN énoncé (un point la scinderait
    // en plusieurs synthèses, cf. proseSegments) et s'entend comme une seule phrase.
    if (cells.length === 2) return `${first} : ${rest[0]}`;
    return [first, ...rest.map((c, k) => (titles[k + 1] ? `${titles[k + 1]} : ${c}` : c))].join(", ");
  });
  return spoken.flatMap((text, i) =>
    withTrailingPause(
      closeUtterance(proseSegments(text, opts)),
      i === spoken.length - 1 ? BLOCK_PAUSE_MS : ITEM_PAUSE_MS,
    ),
  );
}

/**
 * Bascule les fragments FRANÇAIS de ces segments sur la seconde voix française. Réservé aux
 * traductions d'exemples : entendre l'explication et la traduction dans la même voix les rend
 * interchangeables à l'oreille. Les fragments japonais ne bougent pas.
 */
function withExampleVoice(segs: RawSegment[]): RawSegment[] {
  return segs.map((seg) => ({
    ...seg,
    parts: segmentParts(seg).map((p) => (p.lang === "fr" ? { ...p, lang: "frExample" as const } : p)),
  }));
}

/** Paires d'un `:::example` : phrase japonaise, blanc, traduction, blanc plus long. */
function exampleSegments(pairs: { jp: string; fr?: string }[], opts: EmitOpts): RawSegment[] {
  return pairs.flatMap((pair, i) => {
    const last = i === pairs.length - 1;
    const after = last ? BLOCK_PAUSE_MS : EXAMPLE_PAIR_PAUSE_MS;
    // `jp` n'est pas garanti japonais : parseBlocks y range toute ligne non préfixée « > »,
    // y compris une ligne française égarée. La voix se décide sur le contenu, pas sur le champ.
    const jp = pair.jp ? lineSegments(pair.jp, opts) : [];
    const fr = pair.fr ? withExampleVoice(proseSegments(pair.fr, opts)) : [];
    if (!fr.length) return withTrailingPause(jp, after);
    return [...withTrailingPause(jp, EXAMPLE_JA_PAUSE_MS), ...withTrailingPause(fr, after)];
  });
}

/** Encadré : amorce éventuelle, puis son corps re-parsé (il n'est qu'une chaîne brute). */
function calloutSegments(b: Extract<Block, { kind: "callout" }>, opts: EmitOpts): RawSegment[] {
  const body = parseBlocks(b.body).flatMap((inner) => blockSegments(inner, opts));
  if (!body.length) return [];
  const lead = needsLeadIn(b.ctype, body) ? CALLOUT_LEAD_IN[b.ctype] : "";
  const head = lead ? emit([{ lang: "fr", text: lead }], opts) : [];
  return withTrailingPause([...head, ...body], BLOCK_PAUSE_MS);
}

/**
 * Un piège n'a besoin d'être annoncé que s'il OUVRE sur du japonais : la phrase fautive
 * tomberait alors sans prévenir. Quand la leçon commence par expliquer l'erreur en français
 * — le cas le plus courant — l'amorce ferait doublon (« On entend souvent, à tort : Erreur
 * fréquente : … »). Les autres encadrés gardent leur règle : seul le résumé s'annonce.
 */
function needsLeadIn(ctype: Extract<Block, { kind: "callout" }>["ctype"], body: RawSegment[]): boolean {
  if (!CALLOUT_LEAD_IN[ctype]) return false;
  return ctype === "pitfall" ? body[0].lang === "ja" : true;
}

/** Un bloc affiché → les segments qui le PARLENT. */
function blockSegments(b: Block, opts: EmitOpts): RawSegment[] {
  switch (b.kind) {
    case "hr":
      return []; // rien à dire : le blanc du bloc précédent marque déjà la coupure
    case "heading":
      // Par lineSegments, et non en un fragment français d'un bloc : un titre cite très
      // souvent du japonais (« La première phrase : は et を »), que la voix française
      // écorche — は y sort « ka ».
      return withTrailingPause(closeUtterance(lineSegments(b.text, opts)), SECTION_PAUSE_MS);
    case "para":
    case "quote":
      return withTrailingPause(proseLines(b.lines, opts), BLOCK_PAUSE_MS);
    case "ul":
    case "ol":
      return b.items.flatMap((item, i) =>
        withTrailingPause(
          closeUtterance(lineSegments(item, opts)),
          i === b.items.length - 1 ? BLOCK_PAUSE_MS : ITEM_PAUSE_MS,
        ),
      );
    case "table":
      return tableSegments(b.head, b.rows, opts);
    case "example":
      return exampleSegments(b.pairs, opts);
    case "callout":
      return calloutSegments(b, opts);
    default: {
      // Exhaustivité : un nouveau type de bloc DOIT choisir comment il se parle, sinon il
      // disparaîtrait de l'audio sans que rien ne le signale.
      const exhaustive: never = b;
      return exhaustive;
    }
  }
}

/**
 * Transforme la leçon FR (Markdown) en segments parlés, en INTERPRÉTANT sa structure au lieu
 * de l'effacer : chaque bloc de `parseBlocks` (le parseur qui sert aussi à l'affichage) choisit
 * comment il se prononce et quel blanc le suit. « Ce qui est lu » et « ce qui est affiché »
 * dérivent ainsi de la même analyse — d'où le `blockIndex` porté par chaque segment.
 */
function coursSegments(framing: string): RawSegment[] {
  const out: RawSegment[] = [];
  let label = "Cours";
  parseBlocks(framing).forEach((b, blockIndex) => {
    // Seuls les titres de section (niveau ≤ 2) découpent la tracklist ; un titre plus profond
    // est prononcé comme les autres mais ne redécoupe pas la navigation.
    if (b.kind === "heading" && b.level <= 2) label = stripMarkdown(b.text).trim() || label;
    out.push(...blockSegments(b, { label, blockIndex }));
  });
  return out;
}

/**
 * Segment « titre » atomique, séparé des phrases de transition (qui sont fixes) pour que
 * l'un et l'autre soient réutilisables/cacheables indépendamment.
 */
export function titleSegment(text: string, chapter: PodcastChapter): RawSegment {
  return { chapter, lang: "fr", text, label: text };
}

export interface ScriptNav {
  /** Titre de la leçon suivante (annoncé à la fin) ; absent → on boucle au début. */
  nextLessonTitle?: string;
}

/**
 * Assemble le script complet d'une leçon (cours → quiz → histoires → transition de fin).
 * `storyTokens` (phrases tokenisées par histoire, index global — fourni par
 * generatePodcastPack via analyze/splitSentences) active le karaoké mot-à-mot des
 * histoires : timepoints TTS, mêmes entrées de cache audio que la lecture standalone.
 */
export function buildPodcastScript(
  lesson: Lesson,
  nav: ScriptNav = {},
  storyTokens: Map<string, PlayerSentence[]> = new Map(),
): PodcastSegment[] {
  const raw: RawSegment[] = [];

  // 1. Cours — leçon FR (grammaire) parlée, segmentée pour gérer les exemples japonais.
  if (lesson.framing) raw.push(...coursSegments(lesson.framing));

  // 2. Quiz — vocabulaire de la leçon.
  if (lesson.objectives.vocab.length) {
    raw.push({ chapter: "quiz", lang: "fr", text: "Petit quiz pour réviser le vocabulaire.", label: "Quiz" });
    raw.push(...buildVocabQuizzes(lesson.objectives.vocab));
  }

  // 3. Histoire(s) — transition + titre (segments distincts). Si un QCM de compréhension
  //    existe : 1re écoute en japonais SEUL → QCM → 2e écoute japonais + français (la
  //    compréhension n'aurait aucun sens si le français était lu d'emblée). Sinon : repli
  //    sur la lecture bilingue unique (pas de double lecture inutile).
  lesson.stories.forEach((story, s) => {
    const intro = s === 0 ? "Voici une histoire en rapport avec la leçon :" : "Voici l'histoire suivante :";
    raw.push({ chapter: "histoire", lang: "fr", text: intro, label: `Histoire ${s + 1}`, storyId: story.id });
    raw.push({ ...titleSegment(story.titleFr ?? story.title, "histoire"), storyId: story.id });
    // Furigana retiré : la voix japonaise ne doit pas relire la lecture entre parenthèses.
    const ja = splitJaSentences(story.text).map(stripFurigana);
    const fr = story.translation ?? [];
    const questions = story.comprehension ?? [];
    // Phrases tokenisées exploitables seulement si leur découpage s'aligne sur celui des
    // traductions (mêmes terminateurs → quasi toujours) ; sinon repli sans karaoké.
    const tok = storyTokens.get(story.id);
    const aligned = tok && tok.length === ja.length ? tok : null;
    // Phrase JA porteuse de tokens (timepoints → surlignage), ou texte nu en repli.
    const jaSeg = (k: number): RawSegment =>
      aligned
        ? {
            chapter: "histoire",
            lang: "ja",
            text: aligned[k].text,
            tokens: aligned[k].segments,
            baseTokenIndex: aligned[k].baseIndex,
            storyId: story.id,
          }
        : { chapter: "histoire", lang: "ja", text: ja[k], storyId: story.id };

    if (questions.length > 0) {
      // 1re écoute : japonais seul.
      raw.push({ chapter: "histoire", lang: "fr", text: "D'abord, écoutez l'histoire en japonais.", label: "Japonais", storyId: story.id });
      ja.forEach((_, k) => raw.push(jaSeg(k)));
      // QCM de compréhension audio.
      raw.push(...buildComprehensionAudio(questions).map((q) => ({ ...q, storyId: story.id })));
      // 2e écoute : japonais puis français.
      raw.push({ chapter: "histoire", lang: "fr", text: "Réécoutons, en japonais puis en français.", label: "Japonais + français", storyId: story.id });
    }

    // Phrases tokenisées : phrase JA (karaoké) puis traduction FR en segments séparés —
    // le flux MediaSource les enchaîne sans blanc. Repli : paire fusionnée multi-voix.
    ja.forEach((sentence, k) => {
      if (aligned) {
        raw.push(jaSeg(k));
        if (fr[k]) raw.push({ chapter: "histoire", lang: "fr", text: fr[k], storyId: story.id });
      } else if (fr[k]) {
        raw.push({
          chapter: "histoire",
          lang: "ja",
          text: `${sentence} ${fr[k]}`,
          parts: [
            { lang: "ja", text: sentence },
            { lang: "fr", text: fr[k] },
          ],
          storyId: story.id,
        });
      } else {
        raw.push({ chapter: "histoire", lang: "ja", text: sentence, storyId: story.id });
      }
    });
  });

  // 4. Transition de fin — phrase fixe + titre en segments séparés (ou boucle au début).
  if (nav.nextLessonTitle) {
    raw.push({ chapter: "histoire", lang: "fr", text: "Passons à la leçon suivante :", label: "Suite" });
    raw.push(titleSegment(nav.nextLessonTitle, "histoire"));
  } else {
    raw.push({ chapter: "histoire", lang: "fr", text: "Recommençons depuis le début.", label: "Fin" });
  }

  return raw.map((s, i) => ({ id: `${s.chapter}-${i}`, ...normalizeSpoken(s) }));
}
