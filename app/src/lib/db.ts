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
  /** Rattachement optionnel à une leçon du curriculum (SPEC §3). */
  lessonId?: string;
}

/**
 * Cadrage de cours produit par génération LLM, mis en cache localement.
 * Ne contient PLUS l'histoire : les histoires d'une leçon sont des `StoryRecord`
 * liés par `lessonId` (store `stories`).
 */
export interface GeneratedLessonRecord {
  id: string; // = curriculum entry id
  intro: string; // cadrage FR du cours
  createdAt: number;
}

/** Progression locale d'une leçon (commencée, terminée). */
export interface LessonProgressRecord {
  id: string; // = curriculum entry id
  completedAt?: number;
  startedAt?: number;
}

interface LearnDB extends DBSchema {
  vocab: { key: string; value: VocabItem; indexes: { status: string } };
  kanji: { key: string; value: KanjiItem; indexes: { status: string } };
  grammar: { key: string; value: GrammarItem; indexes: { status: string } };
  reviews: { key: number; value: ReviewLog; indexes: { itemId: string } };
  stories: { key: string; value: StoryRecord; indexes: { createdAt: number } };
  lessons: { key: string; value: GeneratedLessonRecord };
  lessonProgress: { key: string; value: LessonProgressRecord };
  /** Cache de dictionnaires volumineux chargés depuis un asset statique (ex. JMdict-FR). */
  dict: { key: string; value: { id: string; map: Record<string, string>; createdAt: number } };
  /**
   * Cache audio TTS, par phrase (SPEC §12). Évite de re-synthétiser une phrase déjà
   * écoutée (quota Cloud TTS) et permet l'écoute hors-ligne (fondation mode voiture).
   * `id` = `${voice}|${rate}|${texte}`. `marks` = timepoints par token (surlignage).
   */
  tts: {
    key: string;
    value: { id: string; audio: Blob; marks: { i: number; t: number }[]; createdAt: number };
  };
}

const DB_NAME = "learn-japan";
const DB_VERSION = 5;

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
        if (!db.objectStoreNames.contains("lessons")) {
          db.createObjectStore("lessons", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("lessonProgress")) {
          db.createObjectStore("lessonProgress", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("dict")) {
          db.createObjectStore("dict", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tts")) {
          db.createObjectStore("tts", { keyPath: "id" });
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
export async function allKanji(): Promise<KanjiItem[]> {
  return (await getDB()).getAll("kanji");
}

// Grammaire ------------------------------------------------------------------
export async function putGrammar(item: GrammarItem): Promise<void> {
  await (await getDB()).put("grammar", item);
}
export async function getGrammar(id: string): Promise<GrammarItem | undefined> {
  return (await getDB()).get("grammar", id);
}
export async function allGrammar(): Promise<GrammarItem[]> {
  return (await getDB()).getAll("grammar");
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
/** Histoires rattachées à une leçon (les plus anciennes d'abord : seed puis générées). */
export async function storiesForLesson(lessonId: string): Promise<StoryRecord[]> {
  const all = await (await getDB()).getAll("stories");
  return all.filter((s) => s.lessonId === lessonId).sort((a, b) => a.createdAt - b.createdAt);
}

// Leçons générées ------------------------------------------------------------
export async function putGeneratedLesson(rec: GeneratedLessonRecord): Promise<void> {
  await (await getDB()).put("lessons", rec);
}
export async function getGeneratedLesson(id: string): Promise<GeneratedLessonRecord | undefined> {
  return (await getDB()).get("lessons", id);
}
export async function deleteGeneratedLesson(id: string): Promise<void> {
  await (await getDB()).delete("lessons", id);
}

// Progression des leçons -----------------------------------------------------
export async function putLessonProgress(rec: LessonProgressRecord): Promise<void> {
  await (await getDB()).put("lessonProgress", rec);
}
export async function getLessonProgress(id: string): Promise<LessonProgressRecord | undefined> {
  return (await getDB()).get("lessonProgress", id);
}
export async function allLessonProgress(): Promise<LessonProgressRecord[]> {
  return (await getDB()).getAll("lessonProgress");
}

// Cache de dictionnaire ------------------------------------------------------
export async function getDictCache(id: string): Promise<Record<string, string> | undefined> {
  return (await (await getDB()).get("dict", id))?.map;
}
export async function putDictCache(id: string, map: Record<string, string>): Promise<void> {
  await (await getDB()).put("dict", { id, map, createdAt: Date.now() });
}

// Cache audio TTS ------------------------------------------------------------
export interface TtsCache {
  audio: Blob;
  marks: { i: number; t: number }[];
}
export async function getTtsCache(id: string): Promise<TtsCache | undefined> {
  const rec = await (await getDB()).get("tts", id);
  return rec ? { audio: rec.audio, marks: rec.marks } : undefined;
}
export async function putTtsCache(id: string, audio: Blob, marks: { i: number; t: number }[]): Promise<void> {
  await (await getDB()).put("tts", { id, audio, marks, createdAt: Date.now() });
}
