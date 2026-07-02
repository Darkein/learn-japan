// Modèle d'exercice unifié (Lecteur + Échauffement). Trois modes, tous avec INPUT :
// QCM tap (choice), saisie texte (type), construction de phrase par tuiles (build).
// Remplace WarmupCard + ParticleQ + ComprehensionQuestion-en-UI ; plus de mode "reveal"
// (auto-note sans réponse produite).

import {
  getComprehensionItem,
  getGrammar,
  getVocab,
  logReview,
  putComprehensionItem,
  putGrammar,
  putVocab,
  type Skill,
} from "./db";
import { newCard, review, type SrsGrade } from "./srs";
import type { KuromojiToken } from "./tokenizer";
import { applyStatus, isContent } from "./vocab";

export type ExerciseTrack = "vocab" | "grammar" | "comprehension";

export const TRACK_FR: Record<ExerciseTrack, string> = {
  vocab: "vocabulaire",
  grammar: "grammaire",
  comprehension: "compréhension",
};

interface ExerciseBase {
  /** Clé stable de rendu (gère doublons). */
  key: string;
  /** Piste SRS notée. */
  track: ExerciseTrack;
  /** Compétence notée (piste vocab uniquement) : carte FSRS dédiée par compétence.
   *  Absent = "written". "oral" = écoute, planifiée indépendamment de l'écrit. */
  skill?: Skill;
  /** Id de l'item SRS (VocabItem.id | GrammarItem.id | ComprehensionItem.id). */
  id: string;
  /** Face avant : mot FR, point de grammaire, ou question. */
  front: string;
  /** Correction affichée après réponse. */
  back: string;
  context?: string;
  /** Lecture audio à faire avant de répondre. */
  audio?: { word: string };
  /** Élément difficile (≥ SRS.leechLapses échecs). */
  isLeech?: boolean;
  /** Échéance FSRS (tri par urgence) ; absent côté Lecteur. */
  due?: number;
  /** Nom/règle utilisés pour CRÉER l'item SRS s'il n'existe pas encore (sinon `front`/`back`). */
  seedName?: string;
  seedRule?: string;
}

export interface TypeExercise extends ExerciseBase {
  mode: "type";
  /** Réponses NORMALISÉES acceptées. */
  answers: string[];
  /** Consigne courte affichée au-dessus du champ. */
  prompt?: string;
}

export interface ChoiceExercise extends ExerciseBase {
  mode: "choice";
  choices: string[];
  answerIndex: number;
  /** Fragments autour du trou (particule à compléter), rendu inline si présent. */
  cloze?: { before: string; after: string };
}

export interface BuildExercise extends ExerciseBase {
  mode: "build";
  /** Suite de surfaces attendue. */
  target: string[];
  /** Tokens de la phrase ; notés sur la piste vocab si `track === "vocab"`. */
  tokens: KuromojiToken[];
}

export type Exercise = TypeExercise | ChoiceExercise | BuildExercise;

/** Note un exercice et replanifie via FSRS. Crée l'item SRS s'il n'existe pas encore. */
export async function gradeExercise(
  ex: Exercise,
  grade: SrsGrade,
  now: Date = new Date(),
): Promise<void> {
  if (ex.mode === "build" && ex.track === "vocab") {
    await Promise.all(
      ex.tokens.filter(isContent).map((t) => applyStatus(t, grade === "again" ? "forgot" : "review", now)),
    );
    return;
  }

  if (ex.track === "vocab") {
    const v = await getVocab(ex.id);
    if (!v) return;
    const skill = ex.skill ?? "written";
    v.cards[skill] = review(v.cards[skill] ?? newCard(now), grade, now);
    // Le statut affiché (soulignement du lecteur) reflète la reconnaissance écrite.
    if (skill === "written") v.status = grade === "easy" ? "known" : "review";
    await putVocab(v);
  } else if (ex.track === "comprehension") {
    const c = (await getComprehensionItem(ex.id)) ?? {
      id: ex.id,
      name: ex.seedName ?? ex.front,
      rule: ex.seedRule ?? ex.back,
      status: "unknown" as const,
      card: undefined,
    };
    c.card = review(c.card ?? newCard(now), grade, now);
    c.status = "review";
    await putComprehensionItem(c);
  } else {
    const g = (await getGrammar(ex.id)) ?? {
      id: ex.id,
      name: ex.seedName ?? ex.front,
      rule: ex.seedRule ?? ex.back,
      examples: [],
      tags: [],
      status: "unknown" as const,
      card: undefined,
    };
    g.card = review(g.card ?? newCard(now), grade, now);
    g.status = "review";
    await putGrammar(g);
  }
  await logReview({
    itemId: ex.id,
    track: ex.track,
    grade,
    at: now.getTime(),
    ...(ex.track === "vocab" ? { skill: ex.skill ?? "written" } : {}),
  });
}

/** Échéance FSRS (en jours) avant la note, pour comparer dans le Bilan. */
export async function daysBeforeGrade(ex: Exercise): Promise<number> {
  if (ex.track === "vocab") {
    const item = await getVocab(ex.id);
    return item?.cards?.[ex.skill ?? "written"]?.scheduled_days ?? 0;
  } else if (ex.track === "grammar") {
    const item = await getGrammar(ex.id);
    return item?.card?.scheduled_days ?? 0;
  } else {
    const item = await getComprehensionItem(ex.id);
    return item?.card?.scheduled_days ?? 0;
  }
}
