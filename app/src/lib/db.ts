// Stockage local (IndexedDB via idb). Local-first : tout l'apprentissage vit ici (SPEC §1, §14).
// AUCUNE donnée perso ne part dans git ; un export/backup arrivera en Phase 4.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Card } from "ts-fsrs";

/** Compétences suivies pour le vocabulaire (SPEC §2.2). */
export type Skill = "written" | "oral" | "production";

/** Statut affiché (SPEC §10). */
export type ItemStatus = "unknown" | "review" | "known";

export interface VocabItem {
  id: string; // ex. "暗記|あんき"
  surface: string;
  reading: string;
  meaning: string;
  tags: string[];
  jlpt?: number;
  status: ItemStatus;
  /** Une carte FSRS par compétence. */
  cards: Partial<Record<Skill, Card>>;
}

export interface KanjiItem {
  id: string; // le kanji lui-même
  kanji: string;
  meanings: string[];
  on: string[];
  kun: string[];
  tags: string[];
  jlpt?: number;
  status: ItemStatus;
  card?: Card;
}

export interface GrammarItem {
  id: string;
  name: string;
  rule: string;
  examples: string[];
  tags: string[];
  jlpt?: number;
  status: ItemStatus;
  card?: Card;
}

export interface ReviewLog {
  id?: number;
  itemId: string;
  track: "vocab" | "kanji" | "grammar";
  skill?: Skill;
  grade: string;
  at: number; // epoch ms
}

/** Histoire générée et enregistrée pour relecture (SPEC §4, §8). */
export interface StoryRecord {
  id: string;
  createdAt: number;
  title: string;
  text: string; // texte japonais source
  /** « Pourquoi cette histoire » : les contraintes de génération. */
  params: { theme?: string; kanji?: string[]; grammar?: string[]; level?: number };
}

interface LearnDB extends DBSchema {
  vocab: { key: string; value: VocabItem; indexes: { status: string } };
  kanji: { key: string; value: KanjiItem; indexes: { status: string } };
  grammar: { key: string; value: GrammarItem; indexes: { status: string } };
  reviews: { key: number; value: ReviewLog; indexes: { itemId: string } };
  stories: { key: string; value: StoryRecord; indexes: { createdAt: number } };
}

const DB_NAME = "learn-japan";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<LearnDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LearnDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LearnDB>(DB_NAME, DB_VERSION, {
      // Upgrade additif et idempotent (gère v0 → v2 et v1 → v2).
      upgrade(db) {
        if (!db.objectStoreNames.contains("vocab")) {
          db.createObjectStore("vocab", { keyPath: "id" }).createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("kanji")) {
          db.createObjectStore("kanji", { keyPath: "id" }).createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("grammar")) {
          db.createObjectStore("grammar", { keyPath: "id" }).createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("reviews")) {
          db.createObjectStore("reviews", { keyPath: "id", autoIncrement: true }).createIndex(
            "itemId",
            "itemId",
          );
        }
        if (!db.objectStoreNames.contains("stories")) {
          db.createObjectStore("stories", { keyPath: "id" }).createIndex("createdAt", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

export async function putVocab(item: VocabItem): Promise<void> {
  await (await getDB()).put("vocab", item);
}

export async function getVocab(id: string): Promise<VocabItem | undefined> {
  return (await getDB()).get("vocab", id);
}

export async function allVocab(): Promise<VocabItem[]> {
  return (await getDB()).getAll("vocab");
}

export async function logReview(entry: ReviewLog): Promise<void> {
  await (await getDB()).add("reviews", entry);
}

// Kanji ----------------------------------------------------------------------
export async function putKanji(item: KanjiItem): Promise<void> {
  await (await getDB()).put("kanji", item);
}
export async function getKanji(id: string): Promise<KanjiItem | undefined> {
  return (await getDB()).get("kanji", id);
}

// Grammaire ------------------------------------------------------------------
export async function putGrammar(item: GrammarItem): Promise<void> {
  await (await getDB()).put("grammar", item);
}
export async function getGrammar(id: string): Promise<GrammarItem | undefined> {
  return (await getDB()).get("grammar", id);
}

// Histoires ------------------------------------------------------------------
export async function putStory(story: StoryRecord): Promise<void> {
  await (await getDB()).put("stories", story);
}
export async function getStory(id: string): Promise<StoryRecord | undefined> {
  return (await getDB()).get("stories", id);
}
export async function deleteStory(id: string): Promise<void> {
  await (await getDB()).delete("stories", id);
}
/** Histoires, les plus récentes d'abord. */
export async function allStories(): Promise<StoryRecord[]> {
  const all = await (await getDB()).getAll("stories");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
