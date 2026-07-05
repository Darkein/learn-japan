// Retrouvailles : quand un mot DÉJÀ APPRIS réapparaît dans une histoire, on le compte —
// le vocabulaire devient un casting récurrent (« croisé pour la 5ᵉ fois · appris il y a
// 12 jours »). Compteurs dans le store `encounters` (db v12), date d'apprentissage dérivée
// du log `reviews` (première entrée pour l'item).

import {
  bumpSrsDaily,
  getDB,
  getEncounter,
  getMeta,
  getVocab,
  localDateString,
  putEncounter,
  putMeta,
} from "./db";

export interface ReEncounter {
  id: string;
  surface: string;
  /** Nombre d'histoires où le mot a été recroisé (0 si jamais compté, ex. histoire non enregistrée). */
  count: number;
  /** Première trace dans le log de révision (epoch ms) — « appris il y a … ». */
  learnedAt?: number;
}

/** Fenêtre anti-rejeu : rouvrir la même histoire dans les 6 h ne recompte pas. */
const REPLAY_MS = 6 * 60 * 60 * 1000;

/** Première entrée du log de révision pour un item (date d'apprentissage). */
async function learnedAtFor(itemId: string): Promise<number | undefined> {
  const logs = await (await getDB()).getAllFromIndex("reviews", "itemId", itemId);
  return logs.length ? Math.min(...logs.map((l) => l.at)) : undefined;
}

/**
 * À l'ouverture d'une histoire analysée : incrémente le compteur des mots déjà appris
 * (item vocab existant avec une carte écrite) présents dans les tokens, marque la lecture
 * du jour (meta `storyRead.<id>` + srsDaily.storiesRead) et renvoie les retrouvailles.
 * Sans `storyId` (histoire non enregistrée), on renvoie l'info sans rien compter.
 */
export async function recordEncounters(
  storyId: string | undefined,
  itemIds: string[],
  now: Date = new Date(),
): Promise<ReEncounter[]> {
  const unique = [...new Set(itemIds)];
  const nowMs = now.getTime();
  const out: ReEncounter[] = [];

  for (const id of unique) {
    const v = await getVocab(id);
    if (!v?.cards.written) continue; // jamais appris → pas une retrouvaille
    let rec = await getEncounter(id);
    const replay = rec?.lastStoryId === storyId && nowMs - (rec?.lastAt ?? 0) < REPLAY_MS;
    if (storyId && !replay) {
      rec = rec
        ? { ...rec, count: rec.count + 1, lastAt: nowMs, lastStoryId: storyId }
        : { id, count: 1, firstAt: nowMs, lastAt: nowMs, lastStoryId: storyId };
      await putEncounter(rec);
    }
    out.push({ id, surface: v.surface, count: rec?.count ?? 0, learnedAt: await learnedAtFor(id) });
  }

  if (storyId) {
    const key = `storyRead.${storyId}`;
    const lastRead = await getMeta<number>(key);
    const today = localDateString(now);
    if (!lastRead || localDateString(new Date(lastRead)) !== today) {
      await bumpSrsDaily(today, { storiesRead: 1 });
    }
    await putMeta(key, nowMs);
  }

  return out;
}

/** Info de retrouvailles d'un mot (pour la fiche mot) — null si jamais recroisé. */
export async function encounterInfo(itemId: string): Promise<ReEncounter | null> {
  const rec = await getEncounter(itemId);
  if (!rec) return null;
  const v = await getVocab(itemId);
  return { id: itemId, surface: v?.surface ?? itemId, count: rec.count, learnedAt: await learnedAtFor(itemId) };
}
