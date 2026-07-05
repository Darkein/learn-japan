// Relecture-miroir : relire périodiquement une VIEILLE histoire pour mesurer le chemin
// parcouru — « à l'époque tu connaissais 12 de ses 45 mots, aujourd'hui 38 ». La preuve
// du progrès comme carburant, sans points ni badges.
//
// « Connu à l'époque » est une approximation honnête : première trace dans le log de
// révision AVANT la création de l'histoire (le log est append-only et horodaté). L'UI
// emploie donc un phrasé prudent (« déjà croisés à l'époque »).

import { analyze } from "./analyze";
import {
  allReviews,
  allVocab,
  getMeta,
  putMeta,
  type ReviewLog,
  type StoryRecord,
  type VocabItem,
} from "./db";
import { isContent, itemIdFor } from "./vocab";

/** Une histoire n'est candidate qu'après un mois — avant, le delta n'a rien à raconter. */
const MIN_STORY_AGE_DAYS = 30;
/** Une relecture-miroir au plus toutes les deux semaines. */
const MIRROR_COOLDOWN_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;
/** Échantillon de mots « appris depuis » affiché (badges). */
const NEW_SINCE_MAX = 8;

export interface MirrorCandidate {
  storyId: string;
  title: string;
  createdAt: number;
  ageDays: number;
}

export interface MirrorDelta {
  /** Mots de contenu uniques de l'histoire. */
  totalWords: number;
  /** Items déjà croisés avant l'écriture de l'histoire (1ʳᵉ review ≤ createdAt). */
  knownThen: number;
  /** Items suivis aujourd'hui (carte écrite existante). */
  knownNow: number;
  /** Surfaces d'un échantillon de mots appris depuis (pour les badges). */
  newSince: string[];
}

/** Choisit la plus ancienne histoire ≥ 30 j, hors période de refroidissement (pur). */
export function pickMirrorCandidate(
  stories: StoryRecord[],
  lastMirrorAt: number | undefined,
  now: Date,
): MirrorCandidate | null {
  if (lastMirrorAt && now.getTime() - lastMirrorAt < MIRROR_COOLDOWN_DAYS * DAY_MS) return null;
  const eligible = stories
    .filter((s) => now.getTime() - s.createdAt >= MIN_STORY_AGE_DAYS * DAY_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
  const story = eligible[0];
  if (!story) return null;
  return {
    storyId: story.id,
    title: story.titleFr ?? story.title,
    createdAt: story.createdAt,
    ageDays: Math.round((now.getTime() - story.createdAt) / DAY_MS),
  };
}

/** Delta avant/maintenant sur les mots d'une histoire (pur). */
export function computeMirrorDelta(
  itemIds: string[],
  reviews: ReviewLog[],
  vocabNow: Map<string, VocabItem>,
  storyCreatedAt: number,
): MirrorDelta {
  const unique = [...new Set(itemIds)];
  const firstReview = new Map<string, number>();
  for (const r of reviews) {
    const prev = firstReview.get(r.itemId);
    if (prev == null || r.at < prev) firstReview.set(r.itemId, r.at);
  }
  let knownThen = 0;
  let knownNow = 0;
  const newSince: string[] = [];
  for (const id of unique) {
    const first = firstReview.get(id);
    const trackedNow = !!vocabNow.get(id)?.cards.written;
    if (first != null && first <= storyCreatedAt) knownThen++;
    if (trackedNow) {
      knownNow++;
      if ((first == null || first > storyCreatedAt) && newSince.length < NEW_SINCE_MAX) {
        newSince.push(vocabNow.get(id)!.surface);
      }
    }
  }
  return { totalWords: unique.length, knownThen, knownNow, newSince };
}

// ---- IO --------------------------------------------------------------------------

/** Candidat courant (lit le refroidissement dans meta `mirror.lastAt`). */
export async function currentMirrorCandidate(
  stories: StoryRecord[],
  now: Date = new Date(),
): Promise<MirrorCandidate | null> {
  const lastAt = await getMeta<number>("mirror.lastAt");
  return pickMirrorCandidate(stories, lastAt, now);
}

/** Tokenise l'histoire et calcule le delta (kuromoji requis — navigateur uniquement). */
export async function runMirrorDelta(story: StoryRecord): Promise<MirrorDelta> {
  const analyzed = await analyze(story.text);
  const ids = analyzed.tokens.filter((t) => isContent(t.token)).map((t) => itemIdFor(t.token));
  const [reviews, vocab] = await Promise.all([allReviews(), allVocab()]);
  return computeMirrorDelta(ids, reviews, new Map(vocab.map((v) => [v.id, v])), story.createdAt);
}

/** Enregistre la relecture (déclenche le refroidissement de 14 jours). */
export async function markMirrorDone(now: Date = new Date()): Promise<void> {
  await putMeta("mirror.lastAt", now.getTime());
}
