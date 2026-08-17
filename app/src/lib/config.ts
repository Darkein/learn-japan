// Configuration runtime. L'URL du Worker de génération est surchargeable via
// VITE_WORKER_URL (build) ; défaut = Worker déployé. Aucune clé ici : le client
// ne parle qu'au Worker, qui détient seul la clé du fournisseur (Together AI).

const FALLBACK_WORKER_URL = "https://learn-japan-gen.learn-japan-gen.workers.dev";

export const WORKER_URL = (
  import.meta.env.VITE_WORKER_URL ?? FALLBACK_WORKER_URL
).replace(/\/+$/, "");

/**
 * Clé PUBLIQUE VAPID du rappel quotidien (Web Push), injectée au build par
 * VITE_VAPID_PUBLIC_KEY. Publique par nature : elle identifie le serveur de push auprès du
 * navigateur, elle ne signe rien (la privée reste un secret du Worker). Vide = pas de push :
 * l'app garde ses rappels locaux (badge, notification à l'ouverture, periodic sync).
 */
export const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();

// Voix Cloud TTS par langue. Le japonais sert au lecteur d'article et aux réponses de quiz ;
// le français sert au mode podcast (cadrage, transitions, quiz, phrases traduites).
export const TTS_VOICES = {
  ja: { voice: "ja-JP-Neural2-B", languageCode: "ja-JP" },
  fr: { voice: "fr-FR-Neural2-A", languageCode: "fr-FR" },
} as const;

export type TtsLang = keyof typeof TTS_VOICES;

// Budget d'un énoncé multi-voix (contrainte du backend TTS : Google limite une requête à
// 5 000 octets de SSML). L'assembleur de script (podcastScript.ts) scinde aux frontières
// de fragments au-delà de ce budget ; la marge couvre l'enrobage <speak>/<voice>.
export const TTS_SSML_BUDGET_BYTES = 4000;
export const TTS_SSML_PART_WRAP_BYTES = 80;

export const SRS = {
  newPerDay: 10,
  dailyGoal: 20,
  /**
   * Taille maximale d'une session de révision. `dailyGoal` ne borne que les nouveautés :
   * sans plafond, un backlog de quelques jours d'absence produit une session-fleuve
   * décourageante. Les items les plus urgents passent d'abord, le reste attend.
   */
  sessionCap: 30,
  /** Plafond du bilan de leçon (« Vérifier mes acquis », scope "all"). */
  sessionAllCap: 10,
  masteredIntervalDays: 21,
  /**
   * Intervalle FSRS (jours) à partir duquel un item compte pour le DÉBLOCAGE de la leçon
   * suivante. Volontairement bien plus bas que `masteredIntervalDays` : la maîtrise (21 j)
   * reste l'objectif affiché, mais exiger 21 j pour avancer gèlerait la progression
   * pendant des semaines.
   */
  unlockIntervalDays: 4,
  leechLapses: 4,
  /** Exercices d'écoute max par session (cartes dues), et amorces de nouvelles cartes écoute. */
  listenMax: 5,
  listenSeeds: 2,
  /** Idem pour la production en contexte (cloze FR→JA sur la phrase d'exemple). */
  prodMax: 4,
  prodSeeds: 2,
  /**
   * Espacement minimal (jours) entre deux passages d'un MÊME mot, quelle que soit la
   * compétence. Un mot porte trois cartes FSRS indépendantes (écrit / écoute / production) :
   * rien n'empêchait leurs échéances de se suivre, et un mot appris tôt (私, 今日) revenait
   * un jour sur deux alors que l'utilisateur répondait « facile » à chaque fois. FSRS reste
   * seul maître des intervalles — on ne fait que décaler l'échéance d'une carte sœur.
   */
  skillGapDays: 3,
  /**
   * Part des items assez stables (`unlockProgress`) à partir de laquelle le CONTRÔLE de fin
   * de leçon s'ouvre : le droit de SE PRÉSENTER, pas le déblocage — celui-ci s'obtient à
   * l'épreuve (lib/exam.ts). Volontairement bas : le contrôle est l'évaluation, pas une
   * récompense pour l'avoir déjà dépassée ; mais on ne se présente pas sans avoir travaillé.
   */
  examEligibility: 0.6,
} as const;

/**
 * Contrôle de fin de leçon (le 関所, lib/exam.ts). Barème pensé pour tomber sur 20 quand la
 * leçon fournit toute la matière — la MOITIÉ des points porte sur la leçon elle-même
 * (règle, emploi, correction, cours), l'autre sur la restitution (dictée, lecture, version,
 * thème). Une section sans matière est retirée et le total baisse d'autant : la note reste
 * ramenée sur 20 plutôt qu'un exercice bâclé pour tenir un total rond.
 *
 *   dictée 3 · lecture 3×1 · version 2×1 · thème 2×1
 *   règle 1×2 · emploi 1×2 · correction 1×2 · cours 2×1 · compréhension 2×1  =  20
 */
export const EXAM = {
  /** Note minimale d'admission (sur 20) : elle seule débloque la leçon suivante. */
  passMark: 12,
  /** Options d'un QCM de contrôle (bonne réponse comprise). */
  choices: 4,
  /**
   * Nombre de questions visé par section. La matière commande : un mot ne passant qu'une
   * fois dans tout le sujet, une leçon pauvre rend moins de questions (cf. allocateWords).
   */
  counts: {
    lecture: 3,
    version: 2,
    theme: 2,
    regle: 1,
    usage: 1,
    cours: 2,
    comprehension: 2,
  },
  /** Points par QUESTION, section par section. */
  points: {
    dictee: 3,
    lecture: 1,
    version: 1,
    theme: 1,
    regle: 2,
    usage: 2,
    correction: 2,
    cours: 1,
    comprehension: 1,
  },
  /** Écoutes autorisées sur une question de dictée — après, on écrit ce qu'on a retenu. */
  listens: 2,
  /** Fraction de station gagnée sur la route en cours quand la barrière est franchie. */
  tokaidoBonus: 0.5,
} as const;
