// Stockage local (IndexedDB via idb). Local-first : tout l'apprentissage vit ici (SPEC §1, §14).
// AUCUNE donnée perso ne part dans git ; un export/backup arrivera en Phase 4.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Card } from "ts-fsrs";
import type { ComprehensionQuestion } from "./genClient";
import type { PodcastSegment } from "./podcastScript";

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
  example?: { ja: string; fr?: string };
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
  track: "vocab" | "grammar" | "comprehension";
  skill?: Skill;
  grade: string;
  at: number; // epoch ms
}

/**
 * Item de la piste « compréhension » (SPEC §5) : une carte FSRS DÉDIÉE à la compréhension
 * d'un point de grammaire, distincte de sa carte de reconnaissance (store `grammar`).
 * Alimentée par le QCM de compréhension (une question ratée replanifie ce point).
 * `id` = identifiant du point de grammaire dans l'inventaire.
 */
export interface ComprehensionItem {
  id: string;
  name: string;
  rule: string;
  status: ItemStatus;
  card?: Card;
}

/** Histoire générée et enregistrée pour relecture (SPEC §4, §8). */
export interface StoryRecord {
  id: string;
  createdAt: number;
  title: string;
  text: string; // texte japonais source
  /** « Pourquoi cette histoire » : les contraintes de génération. */
  params: { theme?: string; grammar?: string[]; grammarIds?: string[]; level?: number };
  /** Rattachement optionnel à une leçon du curriculum (SPEC §3). */
  lessonId?: string;
  /** Numéro de variante (1, 2, …) pour les histoires de leçon pré-générées. */
  variant?: number;
  /** Titre français court (mode podcast : annoncé à l'oral). */
  titleFr?: string;
  /** Traduction FR alignée phrase par phrase sur le découpage JP (mode podcast). */
  translation?: string[];
  /** QCM de compréhension (LLM) mis en cache pour ne pas régénérer à chaque ouverture. */
  comprehension?: ComprehensionQuestion[];
}

/**
 * Pack podcast pré-généré d'une leçon (SPEC §11) : le script (segments cours/quiz/histoire)
 * mis en cache. Les blobs audio vivent dans le store `tts` (préchauffé à la génération) →
 * écoute hors-ligne sans dupliquer l'audio.
 */
export interface PodcastRecord {
  id: string; // = curriculum entry id (lessonId)
  segments: PodcastSegment[];
  createdAt: number;
  /** Version du format de pack (régénération si obsolète). */
  version?: number;
}

/**
 * Cadrage de cours produit par génération LLM, mis en cache localement.
 * Ne contient PLUS l'histoire : les histoires d'une leçon sont des `StoryRecord`
 * liés par `lessonId` (store `stories`).
 */
export interface GeneratedLessonRecord {
  id: string; // = curriculum entry id
  framing: string; // leçon FR rédigée (corps du cours)
  createdAt: number;
  /** Révision du curriculum pour laquelle ce cadrage a été généré (défaut 1). Un cadrage
   * d'une révision antérieure est ignoré à l'hydratation → régénération automatique. */
  rev?: number;
  /**
   * Empreinte des objectifs de la leçon au moment de la génération (voir
   * objectivesHash, lib/lessons.ts). Si le curriculum change pour ce même id, le
   * cours est considéré périmé et régénéré à l'ouverture. Absent = enregistrement
   * antérieur à cette mécanique → traité comme périmé.
   */
  objectivesHash?: string;
}

/** Progression locale d'une leçon (commencée, terminée). */
export interface LessonProgressRecord {
  id: string; // = curriculum entry id
  completedAt?: number;
  startedAt?: number;
  unlockedNotified?: boolean;
}

/** Compteurs journaliers SRS (nouveaux mots + révisions) et d'activité. */
export interface SrsDailyRecord {
  date: string; // "YYYY-MM-DD"
  introduced: number;
  reviewed: number;
  /** v12 — temps actif cumulé dans le flux d'étude (ms). Absent sur les anciens jours. */
  flowMs?: number;
  /** v12 — histoires ouvertes en lecture ce jour. Absent sur les anciens jours. */
  storiesRead?: number;
}

/**
 * Rencontre d'un mot DÉJÀ APPRIS dans une histoire lue (« retrouvailles », SPEC engagement).
 * Un mot croisé dans une nouvelle histoire incrémente `count` — le vocabulaire devient un
 * casting récurrent qu'on a plaisir à recroiser.
 */
export interface EncounterRecord {
  id: string; // = VocabItem.id ("暗記|あんき")
  count: number;
  firstAt: number; // epoch ms
  lastAt: number;
  /** Dernière histoire comptée — anti-double-comptage à la réouverture. */
  lastStoryId?: string;
}

/** Niveaux de fortune omikuji — le niveau module le bonus Tōkaidō du défi (voir FORTUNES). */
export type OmikujiFortune =
  | "daikichi"
  | "kichi"
  | "chukichi"
  | "shokichi"
  | "hankichi"
  | "suekichi"
  | "kyo"
  | "daikyo";

/** Tirage omikuji du jour (un par date locale). */
export interface OmikujiRecord {
  date: string; // "YYYY-MM-DD" (localDateString)
  challengeId: string; // id du catalogue lib/omikuji.ts
  fortune: OmikujiFortune;
  drawnAt: number;
  completedAt?: number;
  /** Instantané des compteurs au tirage — les détecteurs mesurent « depuis le tirage ». */
  baseline: { reviewed: number; prodOk: number; oralOk: number; storiesRead: number };
}

/**
 * Petit KV persistant pour les marqueurs d'engagement : tokaido.maxReached, tokaido.bonus,
 * tokaido.lastCelebrated, mirror.lastAt, storyRead.<id>, reminders, reminder.lastShown…
 */
export interface MetaRecord {
  key: string;
  value: unknown;
}

/** Phase d'un job de génération : le cours (framing) puis l'histoire. */
export type GenJobPhase = "framing" | "story";

/**
 * Job de génération de contenu PERSISTANT (cours + histoire d'une leçon).
 * Enregistré dès le lancement et supprimé à la fin → un rechargement de page peut
 * REPRENDRE la génération là où elle en était (voir lib/genJobs.ts). Un seul job actif
 * par leçon : la clé est `lessonId`.
 */
export interface GenJobRecord {
  lessonId: string; // clé
  title: string;
  /** Inclut la génération du cours (clic « Commencer ») ou histoire seule (« Ajouter ») ? */
  withFraming: boolean;
  /** Variante d'histoire visée (1, 2, …). */
  variant: number;
  phase: GenJobPhase;
  status: "running" | "error";
  error?: string;
  startedAt: number;
  /** Début de la phase courante (epoch ms) — sert à estimer l'avancement. */
  phaseStartedAt: number;
  updatedAt: number;
  /** Régénération demandée : ignore le cache R2 (cours et/ou histoire) pour produire du neuf. */
  refresh?: boolean;
  /** Régénère UNIQUEMENT le cours (framing) sans toucher aux histoires. */
  framingOnly?: boolean;
}

interface LearnDB extends DBSchema {
  vocab: { key: string; value: VocabItem; indexes: { status: string } };
  grammar: { key: string; value: GrammarItem; indexes: { status: string } };
  /** Piste « compréhension » : carte FSRS dédiée par point de grammaire. */
  comprehension: { key: string; value: ComprehensionItem; indexes: { status: string } };
  reviews: { key: number; value: ReviewLog; indexes: { itemId: string } };
  stories: { key: string; value: StoryRecord; indexes: { createdAt: number; lessonId: string } };
  lessons: { key: string; value: GeneratedLessonRecord };
  lessonProgress: { key: string; value: LessonProgressRecord };
  /** Jobs de génération en cours (reprise après rechargement), clé = lessonId. */
  genJobs: { key: string; value: GenJobRecord };
  /** Packs podcast pré-générés (script), clé = lessonId (SPEC §11). */
  podcasts: { key: string; value: PodcastRecord };
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
  /**
   * Illustration d'une histoire (estampe ukiyo-e), générée avec l'histoire côté Worker et
   * mise en cache localement pour l'affichage hors-ligne (v13). `id` = id de l'histoire.
   * Store séparé du `StoryRecord` : le blob est volumineux, on ne veut pas l'embarquer dans
   * les scans de liste (allStories, storiesForLesson).
   */
  storyImages: { key: string; value: { id: string; image: Blob; createdAt: number } };
  /** Compteurs journaliers SRS (nouveaux mots + révisions). */
  srsDaily: { key: string; value: SrsDailyRecord };
  /** Retrouvailles : compteur de rencontres par mot appris (v12). */
  encounters: { key: string; value: EncounterRecord };
  /** Tirage omikuji du jour, clé = date locale (v12). */
  omikuji: { key: string; value: OmikujiRecord };
  /** KV persistant pour les marqueurs d'engagement (v12). */
  meta: { key: string; value: MetaRecord };
}

const DB_NAME = "learn-japan";
const DB_VERSION = 13;

let dbPromise: Promise<IDBPDatabase<LearnDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<LearnDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LearnDB>(DB_NAME, DB_VERSION, {
      // Upgrade additif et idempotent (gère v0 → v2 et v1 → v2).
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains("vocab")) {
          db.createObjectStore("vocab", { keyPath: "id" }).createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("grammar")) {
          db.createObjectStore("grammar", { keyPath: "id" }).createIndex("status", "status");
        }
        if (!db.objectStoreNames.contains("comprehension")) {
          db.createObjectStore("comprehension", { keyPath: "id" }).createIndex("status", "status");
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
        if (!db.objectStoreNames.contains("podcasts")) {
          db.createObjectStore("podcasts", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("genJobs")) {
          db.createObjectStore("genJobs", { keyPath: "lessonId" });
        }
        // v9: index lessonId sur stories (évite le scan complet à chaque listLessons)
        if (db.objectStoreNames.contains("stories")) {
          const storiesStore = transaction.objectStore("stories");
          if (!storiesStore.indexNames.contains("lessonId")) {
            storiesStore.createIndex("lessonId", "lessonId");
          }
        }
        // v10: compteurs journaliers SRS
        if (!db.objectStoreNames.contains("srsDaily")) {
          db.createObjectStore("srsDaily", { keyPath: "date" });
        }
        // v11: le SRS kanji a été retiré de l'app → on purge le store orphelin.
        if (db.objectStoreNames.contains("kanji" as never)) {
          db.deleteObjectStore("kanji" as never);
        }
        // v12: engagement — retrouvailles, omikuji, méta persistante.
        if (!db.objectStoreNames.contains("encounters")) {
          db.createObjectStore("encounters", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("omikuji")) {
          db.createObjectStore("omikuji", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        // v13: illustrations d'histoires (ukiyo-e), cache blob local par id d'histoire.
        if (!db.objectStoreNames.contains("storyImages")) {
          db.createObjectStore("storyImages", { keyPath: "id" });
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

export async function allReviews(): Promise<ReviewLog[]> {
  return (await getDB()).getAll("reviews");
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

// Compréhension (piste dédiée) -----------------------------------------------
export async function putComprehensionItem(item: ComprehensionItem): Promise<void> {
  await (await getDB()).put("comprehension", item);
}
export async function getComprehensionItem(id: string): Promise<ComprehensionItem | undefined> {
  return (await getDB()).get("comprehension", id);
}
export async function allComprehension(): Promise<ComprehensionItem[]> {
  return (await getDB()).getAll("comprehension");
}

// Histoires ------------------------------------------------------------------
export async function putStory(story: StoryRecord): Promise<void> {
  await (await getDB()).put("stories", story);
}
export async function getStory(id: string): Promise<StoryRecord | undefined> {
  return (await getDB()).get("stories", id);
}
export async function deleteStory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("stories", id);
  await db.delete("storyImages", id); // l'illustration suit l'histoire
}
/** Histoires, les plus récentes d'abord. */
export async function allStories(): Promise<StoryRecord[]> {
  const all = await (await getDB()).getAll("stories");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/** Histoires rattachées à une leçon (les plus anciennes d'abord : seed puis générées). */
export async function storiesForLesson(lessonId: string): Promise<StoryRecord[]> {
  const all = await (await getDB()).getAllFromIndex("stories", "lessonId", lessonId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

// Illustrations d'histoires (ukiyo-e) ----------------------------------------
export async function putStoryImage(storyId: string, image: Blob): Promise<void> {
  await (await getDB()).put("storyImages", { id: storyId, image, createdAt: Date.now() });
}
/** Blob de l'illustration d'une histoire, ou null si aucune n'a été générée/cachée. */
export async function getStoryImage(storyId: string): Promise<Blob | null> {
  const rec = await (await getDB()).get("storyImages", storyId);
  return rec?.image ?? null;
}

// Leçons générées ------------------------------------------------------------
export async function putGeneratedLesson(rec: GeneratedLessonRecord): Promise<void> {
  await (await getDB()).put("lessons", rec);
}
export async function getGeneratedLesson(id: string): Promise<GeneratedLessonRecord | undefined> {
  return (await getDB()).get("lessons", id);
}

// Packs podcast ---------------------------------------------------------------
export async function putPodcast(rec: PodcastRecord): Promise<void> {
  await (await getDB()).put("podcasts", rec);
}
export async function getPodcast(id: string): Promise<PodcastRecord | undefined> {
  return (await getDB()).get("podcasts", id);
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

// Jobs de génération (reprise après rechargement) ----------------------------
export async function putGenJob(rec: GenJobRecord): Promise<void> {
  await (await getDB()).put("genJobs", rec);
}
export async function allGenJobs(): Promise<GenJobRecord[]> {
  return (await getDB()).getAll("genJobs");
}
export async function deleteGenJob(lessonId: string): Promise<void> {
  await (await getDB()).delete("genJobs", lessonId);
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

// Compteurs SRS journaliers ---------------------------------------------------
/** Date locale « YYYY-MM-DD » (clé du store `srsDaily`, affichage des séries). */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getSrsDaily(date: string): Promise<SrsDailyRecord | undefined> {
  return (await getDB()).get("srsDaily", date);
}
async function putSrsDaily(rec: SrsDailyRecord): Promise<void> {
  await (await getDB()).put("srsDaily", rec);
}
export async function bumpSrsDaily(
  date: string,
  delta: { introduced?: number; reviewed?: number; flowMs?: number; storiesRead?: number },
): Promise<void> {
  const existing = (await getSrsDaily(date)) ?? { date, introduced: 0, reviewed: 0 };
  await putSrsDaily({
    ...existing,
    introduced: existing.introduced + (delta.introduced ?? 0),
    reviewed: existing.reviewed + (delta.reviewed ?? 0),
    flowMs: (existing.flowMs ?? 0) + (delta.flowMs ?? 0),
    storiesRead: (existing.storiesRead ?? 0) + (delta.storiesRead ?? 0),
  });
}
export async function recentSrsDaily(nDays: number): Promise<SrsDailyRecord[]> {
  const result: SrsDailyRecord[] = [];
  const today = new Date();
  for (let i = nDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = localDateString(d);
    result.push((await getSrsDaily(date)) ?? { date, introduced: 0, reviewed: 0 });
  }
  return result;
}

// Retrouvailles (rencontres de mots appris) ------------------------------------
export async function getEncounter(id: string): Promise<EncounterRecord | undefined> {
  return (await getDB()).get("encounters", id);
}
export async function putEncounter(rec: EncounterRecord): Promise<void> {
  await (await getDB()).put("encounters", rec);
}
export async function allEncounters(): Promise<EncounterRecord[]> {
  return (await getDB()).getAll("encounters");
}

// Omikuji ----------------------------------------------------------------------
export async function getOmikuji(date: string): Promise<OmikujiRecord | undefined> {
  return (await getDB()).get("omikuji", date);
}
export async function putOmikuji(rec: OmikujiRecord): Promise<void> {
  await (await getDB()).put("omikuji", rec);
}

// Méta (KV persistant) ---------------------------------------------------------
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const rec = await (await getDB()).get("meta", key);
  return rec?.value as T | undefined;
}
export async function putMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put("meta", { key, value });
}

export function _resetDbForTests(): void {
  dbPromise = null;
}
