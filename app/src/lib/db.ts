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

interface LearnDB extends DBSchema {
  vocab: { key: string; value: VocabItem; indexes: { status: string } };
  kanji: { key: string; value: KanjiItem; indexes: { status: string } };
  grammar: { key: string; value: GrammarItem; indexes: { status: string } };
  reviews: { key: number; value: ReviewLog; indexes: { itemId: string } };
}

const DB_NAME = "learn-japan";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<LearnDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LearnDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LearnDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const vocab = db.createObjectStore("vocab", { keyPath: "id" });
        vocab.createIndex("status", "status");
        const kanji = db.createObjectStore("kanji", { keyPath: "id" });
        kanji.createIndex("status", "status");
        const grammar = db.createObjectStore("grammar", { keyPath: "id" });
        grammar.createIndex("status", "status");
        const reviews = db.createObjectStore("reviews", {
          keyPath: "id",
          autoIncrement: true,
        });
        reviews.createIndex("itemId", "itemId");
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
