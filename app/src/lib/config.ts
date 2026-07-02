// Configuration runtime. L'URL du Worker de génération est surchargeable via
// VITE_WORKER_URL (build) ; défaut = Worker déployé. Aucune clé ici : le client
// ne parle qu'au Worker, qui détient seul la clé Gemini.

const FALLBACK_WORKER_URL = "https://learn-japan-gen.learn-japan-gen.workers.dev";

export const WORKER_URL = (
  import.meta.env.VITE_WORKER_URL ?? FALLBACK_WORKER_URL
).replace(/\/+$/, "");

// Voix Cloud TTS par langue. Le japonais sert au lecteur d'article et aux réponses de quiz ;
// le français sert au mode podcast (cadrage, transitions, quiz, phrases traduites).
export const TTS_VOICES = {
  ja: { voice: "ja-JP-Neural2-B", languageCode: "ja-JP" },
  fr: { voice: "fr-FR-Neural2-A", languageCode: "fr-FR" },
} as const;

export type TtsLang = keyof typeof TTS_VOICES;

export const SRS = {
  newPerDay: 10,
  dailyGoal: 20,
  /**
   * Taille maximale d'une session de révision. `dailyGoal` ne borne que les nouveautés :
   * sans plafond, un backlog de quelques jours d'absence produit une session-fleuve
   * décourageante. Les items les plus urgents passent d'abord, le reste attend.
   */
  sessionCap: 30,
  masteredIntervalDays: 21,
  /**
   * Intervalle FSRS (jours) à partir duquel un item compte pour le DÉBLOCAGE de la leçon
   * suivante. Volontairement bien plus bas que `masteredIntervalDays` : la maîtrise (21 j)
   * reste l'objectif affiché, mais exiger 21 j pour avancer gèlerait la progression
   * pendant des semaines.
   */
  unlockIntervalDays: 4,
  unlockMastery: 0.8,
  leechLapses: 4,
} as const;
