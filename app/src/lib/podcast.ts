// Mode podcast (SPEC §11), partie EFFETS : s'assure qu'une histoire a sa traduction FR
// alignée (LLM, avec cache sur le StoryRecord) et pré-génère le pack d'une leçon (script
// persisté). L'audio, lui, est synthétisé à la demande par le lecteur (segmentPlayer) et
// matérialisé en cache par le téléchargement hors-ligne (lib/download.ts).
// L'assemblage pur du script vit dans lib/podcastScript.ts.

import { analyze } from "./analyze";
import {
  getStory,
  putPodcast,
  putStory,
  type PodcastRecord,
  type StoryRecord,
} from "./db";
import { backfillExampleFr } from "./enroll";
import { generateStoryTranslation } from "./genClient";
import { splitJaSentences } from "./kana";
import {
  addLessonStory,
  ensureLessonFraming,
  getLesson,
} from "./lessons";
import {
  buildPodcastScript,
  cleanFrench,
  containsJa,
  PACK_VERSION,
  type ScriptNav,
} from "./podcastScript";
import { ensureComprehensionQuiz } from "./stories";
import { splitSentences, type PlayerSentence } from "./tts";

// ---------- Traduction d'histoire (préalable à l'assemblage) -----------------

/** Une traduction est exploitable si elle est présente, complète et SANS japonais résiduel. */
function translationIsClean(story: StoryRecord): boolean {
  if (!story.translation?.length || !story.titleFr) return false;
  return !containsJa(story.titleFr) && !story.translation.some(containsJa);
}

/**
 * S'assure qu'une histoire a une traduction FR alignée + un titre FR, **en français pur**.
 * Régénère si elle manque OU si une ancienne traduction contient encore du japonais
 * (auto-réparation des packs générés avant le durcissement du prompt). Nettoie en plus
 * défensivement (`cleanFrench`) pour ne jamais relire un mot déjà prononcé en japonais.
 */
async function ensureStoryTranslation(story: StoryRecord): Promise<StoryRecord> {
  if (translationIsClean(story)) return story;
  const ja = splitJaSentences(story.text);
  const { titleFr, sentences } = await generateStoryTranslation(ja, story.params.level ?? 5);
  const updated: StoryRecord = {
    ...story,
    titleFr: cleanFrench(titleFr),
    translation: sentences.map(cleanFrench),
  };
  await putStory(updated);
  // Les phrases d'exemple du vocab enrôlé depuis cette histoire gagnent leur FR.
  await backfillExampleFr(updated);
  return updated;
}

/**
 * Traduction FR fluide d'une histoire (titre + phrases alignées), avec cache partagé sur le
 * `StoryRecord` (mêmes champs que le podcast). Réutilisée par le lecteur texte pour afficher la
 * « vraie » traduction (≠ gloss mot-à-mot) après le quiz. Histoire non enregistrée (lecteur
 * libre) → génère sans persister.
 */
export async function ensureStoryTranslationById(
  storyId: string | undefined,
  text: string,
  level: number,
): Promise<{ titleFr: string; sentences: string[] }> {
  if (storyId) {
    const story = await getStory(storyId);
    if (story) {
      const updated = await ensureStoryTranslation(story);
      return { titleFr: updated.titleFr ?? "", sentences: updated.translation ?? [] };
    }
  }
  const { titleFr, sentences } = await generateStoryTranslation(splitJaSentences(text), level);
  return { titleFr: cleanFrench(titleFr), sentences: sentences.map(cleanFrench) };
}

// ---------- Pré-génération du pack -------------------------------------------

export interface PackProgress {
  (message: string): void;
}

/**
 * Pré-génère le pack podcast d'une leçon : s'assure que le cadrage + au moins une histoire
 * (traduite) existent, assemble le script et l'ENREGISTRE. Aucune synthèse audio ici : le
 * lecteur synthétise segment par segment (avec préchargement du suivant), et le
 * téléchargement hors-ligne (download.ts) matérialise l'audio du pack en cache.
 */
export async function generatePodcastPack(
  lessonId: string,
  nav: ScriptNav = {},
  onProgress?: PackProgress,
): Promise<PodcastRecord> {
  let lesson = await getLesson(lessonId);
  if (!lesson) throw new Error(`Leçon introuvable : ${lessonId}`);

  onProgress?.("Préparation du cours…");
  await ensureLessonFraming(lesson);

  if (lesson.stories.length === 0) {
    onProgress?.("Génération d'une histoire…");
    await addLessonStory(lesson, 1);
    lesson = (await getLesson(lessonId))!;
  }

  for (const story of lesson.stories) {
    // ensureStoryTranslation décide elle-même (manquante ou « sale » → régénère).
    onProgress?.("Traduction de l'histoire…");
    await ensureStoryTranslation(story);
  }

  // QCM de compréhension par histoire (best-effort) : peuple le cache `StoryRecord.comprehension`
  // avant l'assemblage → la passe « japonais seul + quiz + bilingue » s'active. En cas d'échec
  // (hors-ligne / clé absente), on poursuit sans : l'histoire retombe sur la lecture bilingue.
  const grammar = { ids: lesson.introduces.grammar, labels: lesson.objectives.grammar };
  for (const story of lesson.stories) {
    onProgress?.("Quiz de compréhension…");
    try {
      await ensureComprehensionQuiz(story.id, story.text, story.params.level ?? lesson.level, grammar);
    } catch {
      // QCM indisponible → repli sur la passe bilingue unique (sans chapitre Compréhension).
    }
  }

  lesson = (await getLesson(lessonId))!; // re-hydrate avec traductions/titres/QCM à jour

  // Phrases tokenisées par histoire (mêmes tokens que le Reader → index global aligné) :
  // active le karaoké mot-à-mot dans le pack. Tokenizer indisponible → pack sans surlignage.
  const storyTokens = new Map<string, PlayerSentence[]>();
  for (const story of lesson.stories) {
    onProgress?.("Analyse de l'histoire…");
    try {
      const analyzed = await analyze(story.text);
      storyTokens.set(story.id, splitSentences(analyzed.tokens));
    } catch {
      // repli : paire fusionnée sans karaoké pour cette histoire
    }
  }

  const segments = buildPodcastScript(lesson, nav, storyTokens);
  const rec: PodcastRecord = { id: lessonId, segments, createdAt: Date.now(), version: PACK_VERSION };
  await putPodcast(rec);
  return rec;
}
