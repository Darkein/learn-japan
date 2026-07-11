// Mode podcast (SPEC §11), partie EFFETS : s'assure qu'une histoire a sa traduction FR
// alignée (LLM, avec cache sur le StoryRecord), pré-génère le pack d'une leçon (script +
// préchauffage de l'audio dans le store `tts`) → écoute hors-ligne.
// L'assemblage pur du script vit dans lib/podcastScript.ts.

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
import { synthesizeText, TtsUnconfiguredError } from "./ttsClient";

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

export interface PackOptions {
  /**
   * Préchauffer l'audio de tous les segments (cache `tts`) — nécessaire au mode hors-ligne
   * (téléchargements). Le LECTEUR passe `false` : il démarre dès que le script est assemblé
   * et laisse le moteur synthétiser chaque segment à la demande (avec préchargement du
   * suivant) — sinon un pack non téléchargé impose de longues minutes de silence
   * (« Synthèse audio 12/87… ») avant la première parole.
   */
  prewarmAudio?: boolean;
}

/**
 * Pré-génère le pack podcast d'une leçon : s'assure que le cadrage + au moins une histoire
 * (traduite) existent, assemble le script, l'ENREGISTRE, puis préchauffe l'audio (cache
 * `tts`). L'enregistrement précède le préchauffage : un préchauffage interrompu (réseau)
 * laisse un pack complet et jouable — seule la synthèse reprendra. Si le Worker n'a pas de
 * clé TTS, le script reste utilisable (le lecteur bascule sur la Web Speech API).
 */
export async function generatePodcastPack(
  lessonId: string,
  nav: ScriptNav = {},
  onProgress?: PackProgress,
  opts: PackOptions = {},
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

  const segments = buildPodcastScript(lesson, nav);
  const rec: PodcastRecord = { id: lessonId, segments, createdAt: Date.now(), version: PACK_VERSION };
  await putPodcast(rec); // AVANT le préchauffage (cf. docstring)

  if (opts.prewarmAudio ?? true) {
    // Préchauffe l'audio segment par segment (mise en cache). On s'arrête proprement si le
    // TTS n'est pas configuré : le script reste utilisable via la Web Speech API. Un échec
    // ponctuel (timeout, 5xx) est retenté une fois — sur des dizaines de segments en réseau
    // mobile, un unique raté ne doit pas faire échouer tout le téléchargement.
    const spoken = segments.filter((s) => s.text.trim());
    let done = 0;
    for (const s of spoken) {
      onProgress?.(`Synthèse audio… ${++done}/${spoken.length}`);
      try {
        await synthesizeText(s.text, s.lang);
      } catch (e) {
        if (e instanceof TtsUnconfiguredError) break;
        try {
          await synthesizeText(s.text, s.lang);
        } catch (e2) {
          if (e2 instanceof TtsUnconfiguredError) break;
          throw e2;
        }
      }
    }
  }
  return rec;
}
