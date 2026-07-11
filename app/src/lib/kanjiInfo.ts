// Infos kanji d'un mot : décomposition d'une surface en kanji, et mots de
// l'inventaire partageant un kanji (pour apprendre du neuf sur une base connue).
// Purement référentiel — aucun SRS kanji (store supprimé en DB v11).

import type { ItemStatus } from "./db";
import { allVocabInv, kanjiDetail, type InvVocab, type KanjiDetail } from "./inventory";
import { answerVariants, isKanji } from "./kana";

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
