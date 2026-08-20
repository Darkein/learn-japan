// Infos kanji d'un mot : décomposition d'une surface en kanji, et mots de
// l'inventaire partageant un kanji (pour apprendre du neuf sur une base connue).
// Purement référentiel — aucun SRS kanji (store supprimé en DB v11).

import type { ItemStatus } from "./db";
import { fitFurigana } from "./furigana";
import { allVocabInv, kanjiDetail, type InvVocab, type KanjiDetail } from "./inventory";
import { answerVariants, isKanji, kataToHira } from "./kana";

/** Kanji uniques d'une surface, dans l'ordre d'apparition (kana/latin ignorés). */
export function kanjiIn(surface: string): string[] {
  const seen = new Set<string>();
  for (const ch of surface) if (isKanji(ch)) seen.add(ch);
  return [...seen];
}

/** Décomposition affichable d'un mot : kanji résolus via l'inventaire, les
 * caractères qui n'y figurent pas (々, hors jōyō…) sont omis. */
export function kanjiBreakdown(surface: string): KanjiDetail[] {
  return kanjiIn(surface)
    .map((ch) => kanjiDetail(ch))
    .filter((k): k is KanjiDetail => k !== null);
}

// ---- Lectures d'un kanji, vues depuis un mot ------------------------------

/**
 * Noyau kana d'une lecture KANJIDIC : ce que le CARACTÈRE lit, sans son okurigana ni les
 * tirets de position — « あたた.かい » → « あたた », « -がわ » → « がわ », « せい » → « せい ».
 */
function readingStem(reading: string): string {
  return kataToHira(reading).split(".")[0].replace(/^-+|-+$/g, "");
}

// Rendaku : première syllabe voisée dans un composé (神社 じん+じゃ pour しゃ). On compare
// les deux formes ramenées au non-voisé plutôt que d'énumérer les cas.
const UNVOICED: Record<string, string> = {
  が: "か", ぎ: "き", ぐ: "く", げ: "け", ご: "こ",
  ざ: "さ", じ: "し", ず: "す", ぜ: "せ", ぞ: "そ",
  だ: "た", ぢ: "ち", づ: "つ", で: "て", ど: "と",
  ば: "は", び: "ひ", ぶ: "ふ", べ: "へ", ぼ: "ほ",
  ぱ: "は", ぴ: "ひ", ぷ: "ふ", ぺ: "へ", ぽ: "ほ",
};

function unvoiced(s: string): string {
  return [...s].map((c) => UNVOICED[c] ?? c).join("");
}

/** Gémination : la finale d'une lecture tombe en petit tsu devant la suivante (一回 いっかい). */
function geminated(s: string): string {
  return /[つちきく]$/.test(s) ? s.slice(0, -1) + "っ" : s;
}

/** Lecture entière, okurigana compris, tirets et point de coupe retirés : « あたた.かい » → « あたたかい ». */
function readingFull(reading: string): string {
  return kataToHira(reading).replace(/\./g, "").replace(/-/g, "");
}

/**
 * À quel point cette lecture du dictionnaire est à l'œuvre dans `wordReading` : longueur de
 * la plus longue de ses formes qu'on y retrouve, 0 si aucune. Recherche de sous-chaîne
 * tolérante au rendaku et à la gémination.
 *
 * Le SCORE, et pas un simple booléen, parce que plusieurs lectures d'un même kanji se
 * retrouvent dans un mot et que la plus vague ne doit pas passer devant : dans 一回 (いっかい),
 * 回 vaut かい, mais son か.える y « colle » aussi par son seul か ; dans 温かい (あたたかい),
 * あたた.か colle autant que あたた.かい. La forme la plus longue est la bonne.
 *
 * Heuristique d'AFFICHAGE : elle trie des lectures, jamais ne corrige une réponse — un faux
 * positif ne coûte qu'une lecture montrée un rang trop haut.
 */
function matchScore(wordReading: string, reading: string): number {
  const forms = [readingStem(reading), readingFull(reading)].filter(Boolean);
  let best = 0;
  for (const form of forms) {
    for (const f of [form, geminated(form)]) {
      const hit = wordReading.includes(f) || unvoiced(wordReading).includes(unvoiced(f));
      if (hit) best = Math.max(best, form.length);
    }
  }
  return best;
}

/**
 * Lecture de `ch` DANS ce mot, quand l'okurigana permet de l'isoler (温い → 温 lit « ぬる »).
 * Repli des lectures absentes du dataset : KANJIDIC ne donne pas ぬる.い sous 温, et un
 * composé tout en kanji (学生) n'est pas découpable — on rend alors undefined.
 */
function readingInWord(surface: string, reading: string, ch: string): string | undefined {
  for (const seg of fitFurigana(surface, reading)) {
    if (seg.base === ch && seg.ruby) return seg.ruby;
  }
  return undefined;
}

/**
 * Lectures d'un kanji ORDONNÉES pour le mot d'où l'on vient : celles à l'œuvre dans ce mot
 * d'abord, le reste ensuite (kun puis on, ordre du référentiel).
 *
 * L'appelant tronque cette liste — une rangée de fiche ne tient pas douze lectures. Sans cet
 * ordre, la troncature coupe justement la lecture qui explique le mot : 温い (ぬるい) montrait
 * les quatre あたた.* de 温かい, et 学生 (がくせい) les い.きる de 生 — la fiche donnait alors
 * les lectures d'un AUTRE mot, ce qui fabrique la confusion au lieu de la lever.
 */
export function wordKanjiReadings(k: KanjiDetail, surface: string, reading?: string): string[] {
  const all = [...k.kun, ...k.on];
  if (!reading) return all;
  const wordReading = kataToHira(reading);
  const scored = all.map((r) => ({ r, score: matchScore(wordReading, r) }));
  const used = scored.filter((x) => x.score > 0);
  if (used.length === 0) {
    const inWord = readingInWord(surface, wordReading, k.ja);
    return inWord ? [inWord, ...all] : all;
  }
  // Tri STABLE : à score égal, l'ordre du référentiel (kun puis on) tranche.
  used.sort((a, b) => b.score - a.score);
  return [...used.map((x) => x.r), ...scored.filter((x) => x.score === 0).map((x) => x.r)];
}

// Index caractère → mots de l'inventaire le contenant. Construit paresseusement
// une seule fois ; hérite du tri N5 → N1 de allVocabInv().
let vocabByKanji: Map<string, InvVocab[]> | null = null;

/** Mots de l'inventaire contenant `ch`, triés N5 → N1. */
export function vocabWithKanji(ch: string): InvVocab[] {
  if (!vocabByKanji) {
    vocabByKanji = new Map();
    for (const v of allVocabInv()) {
      for (const k of kanjiIn(v.ja)) {
        const list = vocabByKanji.get(k);
        if (list) list.push(v);
        else vocabByKanji.set(k, [v]);
      }
    }
  }
  return vocabByKanji.get(ch) ?? [];
}

/**
 * Clés de correspondance d'un id `surface|reading`. Deux espaces d'ids coexistent
 * en base : ceux du lecteur (token, « 勉強|べんきょう ») et ceux de l'inventaire
 * (lecture annotée, « 勉強|べんきょう (する) »). On développe la lecture en toutes
 * ses variantes (answerVariants) pour les faire se rejoindre.
 */
function matchKeys(id: string): string[] {
  const sep = id.indexOf("|");
  const surface = sep < 0 ? id : id.slice(0, sep);
  const reading = sep < 0 ? "" : id.slice(sep + 1);
  return answerVariants(reading || surface).map((r) => `${surface}|${r}`);
}

const STATUS_RANK: Record<ItemStatus, number> = { unknown: 0, review: 1, known: 2 };

/**
 * Mots liés à un kanji, partitionnés : d'abord ceux déjà travaillés (statut
 * `known`/`review` en base — pour ancrer), puis les suggestions à découvrir.
 * `excludeId` retire le mot d'où l'on vient (sa propre fiche est déjà ouverte).
 */
export function relatedWords(
  ch: string,
  statuses: Map<string, ItemStatus>,
  excludeId?: string,
): { known: { word: InvVocab; status: ItemStatus }[]; suggestions: InvVocab[] } {
  // Statuts ré-indexés par clé normalisée ; en cas de collision, le plus avancé gagne.
  const byKey = new Map<string, ItemStatus>();
  for (const [id, s] of statuses) {
    for (const key of matchKeys(id)) {
      const prev = byKey.get(key);
      if (!prev || STATUS_RANK[s] > STATUS_RANK[prev]) byKey.set(key, s);
    }
  }
  const excludeKeys = excludeId ? new Set(matchKeys(excludeId)) : null;

  const known: { word: InvVocab; status: ItemStatus }[] = [];
  const suggestions: InvVocab[] = [];
  for (const v of vocabWithKanji(ch)) {
    const keys = matchKeys(v.id);
    if (excludeKeys && (v.id === excludeId || keys.some((k) => excludeKeys.has(k)))) continue;
    const s =
      statuses.get(v.id) ??
      keys.reduce<ItemStatus | undefined>((acc, k) => acc ?? byKey.get(k), undefined);
    if (s === "known" || s === "review") known.push({ word: v, status: s });
    else suggestions.push(v);
  }
  return { known, suggestions };
}
