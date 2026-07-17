// Reco de lecture : classe les histoires pour l'apprentissage extensif. Une bonne lecture est
// « i+1 » — juste assez au-dessus du niveau (≈ 90-95 % de mots connus, cf. readability.ts) —
// et, mieux encore, elle recroise les mots que l'utilisateur doit justement réviser : la
// lecture devient alors une révision SRS EN CONTEXTE. Deux signaux combinés : couverture
// connue (bande i+1) + nombre de mots dus/à-revoir présents.
//
// Perf : la couverture exige de tokeniser le texte (kuromoji), coûteux. On met en cache la
// SUITE d'ids de mots de contenu par histoire (stable tant que le texte ne change pas) dans
// le KV `meta` ; le classement ne refait alors qu'une intersection bon marché avec les statuts
// SRS courants. Cœur de scoring pur (testable) + wrapper IO.

import {
  allStories,
  allVocab,
  getMeta,
  putMeta,
  type ItemStatus,
  type StoryRecord,
} from "./db";
import { isDue } from "./srs";
import { tokenize } from "./tokenizer";
import { isContent, itemIdFor, statusesFor } from "./vocab";

/** Couverture connue idéale (pic de la cloche de score). */
export const PEAK_COVERAGE = 0.92;

export interface StoryScore {
  /** Couverture connue (known / occurrences de mots de contenu). */
  coverage: number;
  /** Occurrences de mots de contenu (0 = pas un texte à lire). */
  total: number;
  /** Mots DISTINCTS dus / à revoir présents dans l'histoire (révision contextuelle). */
  dueHits: number;
  /** Score composite (bande i+1 + bonus mots dus). */
  score: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Score d'une histoire (pur). Cloche asymétrique autour de `PEAK_COVERAGE` (pic à ~0.92) :
 *  - au-dessus du pic (trop facile), décroissance RAPIDE → 0 à 100 % : un texte quasi tout
 *    connu n'apprend presque rien, on le déprioritise fort ;
 *  - en dessous du pic (plus dur), décroissance plus douce → 0 à ~0.77 : un texte un peu
 *    exigeant a de la valeur d'apprentissage tant qu'il reste compréhensible ; en dessous
 *    de ~77 % de mots connus il devient trop dur pour la lecture extensive.
 * Bonus proportionnel aux mots dus présents (plafonné) : à couverture égale, on préfère
 * l'histoire qui fait réviser (révision en contexte).
 */
export function scoreStory(coverage: number, total: number, dueHits: number): number {
  if (total === 0) return -Infinity;
  const band =
    coverage >= PEAK_COVERAGE
      ? clamp01(1 - (coverage - PEAK_COVERAGE) / (1 - PEAK_COVERAGE)) // 1 au pic → 0 à 100 %
      : clamp01(1 - (PEAK_COVERAGE - coverage) / 0.15); // 1 au pic → 0 à ~77 %
  const dueBonus = Math.min(dueHits, 8) * 0.05; // jusqu'à +0.40
  return band + dueBonus;
}

export interface Recommendation extends StoryScore {
  story: StoryRecord;
}

interface StoryTokensCache {
  hash: string;
  ids: string[];
}

/** Hash rapide (djb2) du texte, pour invalider le cache si l'histoire change. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${h >>> 0}`;
}

/** Suite d'ids de mots de contenu (avec répétitions) d'une histoire, mise en cache dans `meta`. */
async function storyContentIds(story: StoryRecord): Promise<string[]> {
  const key = `storyTokens.${story.id}`;
  const hash = hashText(story.text);
  const cached = await getMeta<StoryTokensCache>(key);
  if (cached && cached.hash === hash) return cached.ids;
  const tokens = await tokenize(story.text);
  const ids = tokens.filter(isContent).map(itemIdFor);
  await putMeta(key, { hash, ids } satisfies StoryTokensCache);
  return ids;
}

/** Ids de vocabulaire dus (carte écrite échue) ou au statut « à revoir ». */
async function dueLearningIds(now: Date): Promise<Set<string>> {
  const vocab = await allVocab();
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);
  const ids = new Set<string>();
  for (const v of vocab) {
    if (v.status === "review" || (v.cards.written && isDue(v.cards.written, horizon))) ids.add(v.id);
  }
  return ids;
}

function coverageFrom(ids: string[], statuses: Map<string, ItemStatus>, dueIds: Set<string>): StoryScore {
  let total = 0;
  let known = 0;
  const dueSeen = new Set<string>();
  for (const id of ids) {
    total++;
    if (statuses.get(id) === "known") known++;
    if (dueIds.has(id)) dueSeen.add(id);
  }
  const coverage = total === 0 ? 1 : known / total;
  const dueHits = dueSeen.size;
  return { coverage, total, dueHits, score: scoreStory(coverage, total, dueHits) };
}

/**
 * Histoires classées par pertinence de lecture (meilleures d'abord), filtrées à un score
 * positif (bande i+1 atteinte). `stories` peut être fourni pour éviter un rechargement.
 */
export async function recommendStories(
  now: Date = new Date(),
  stories?: StoryRecord[],
): Promise<Recommendation[]> {
  const all = stories ?? (await allStories());
  if (!all.length) return [];
  const dueIds = await dueLearningIds(now);
  const perStory = await Promise.all(
    all.map(async (story) => ({ story, ids: await storyContentIds(story) })),
  );
  const union = [...new Set(perStory.flatMap((p) => p.ids))];
  const statuses = await statusesFor(union);
  const recs = perStory
    .map(({ story, ids }) => ({ story, ...coverageFrom(ids, statuses, dueIds) }))
    .filter((r) => r.total > 0 && r.score > 0);
  return recs.sort((a, b) => b.score - a.score);
}
