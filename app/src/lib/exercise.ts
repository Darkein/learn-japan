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
import { generateStoryTranslation } from "./genClient";
import { isJaSentenceEnd } from "./kana";
import { newCard, review, type SrsGrade } from "./srs";
import type { KuromojiToken } from "./tokenizer";
import { applyStatus, isContent, type StatusAction } from "./vocab";

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
  /** Sens FR du mot (piste vocab) : affiché en clair dans la correction d'un échec, pour
   *  revoir la traduction du mot raté quand la face avant ne la montre pas déjà. */
  meaning?: string;
  context?: string;
  /** Traduction FR de la phrase de contexte (affichée dans la correction). */
  contextFr?: string;
  /** Lecture audio à faire avant de répondre : phrase ou mot (Web Speech). */
  audio?: { word?: string; sentence?: string };
  /** Écoute proposée APRÈS la réponse (correction) quand il n'y a pas de phrase de contexte. */
  audioBack?: { word?: string; sentence?: string };
  /** Exercice à l'aveugle : la face avant ne montre PAS le texte entendu (QCM de sens,
   *  dictée) — bouton « Réécouter » et échappatoire « Afficher le texte » dans la carte. */
  audioOnly?: boolean;
  /** Élément difficile (≥ SRS.leechLapses échecs). */
  isLeech?: boolean;
  /** Échéance FSRS (tri par urgence) ; absent côté Lecteur. */
  due?: number;
  /** Nom/règle utilisés pour CRÉER l'item SRS s'il n'existe pas encore (sinon `front`/`back`). */
  seedName?: string;
  seedRule?: string;
  /** Token source (exercices mono-mot dérivés d'une histoire : lecture/choix de kanji) —
   *  la note passe par `applyStatus`, qui CRÉE l'item vocab s'il n'existe pas encore. */
  token?: KuromojiToken;
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

/**
 * Restreint un cloze à la SEULE phrase contenant le trou : `before`/`after` peuvent
 * couvrir l'article entier (quiz particules) ; on coupe aux bornes de phrase (。！？．!?
 * ou saut de ligne). Mêmes bornes que `splitJaSentences`. Sert à n'afficher que la phrase
 * en cours (plus tout l'article) et à retrouver la traduction alignée.
 */
export function clozeSentenceParts(cloze: { before: string; after: string }): {
  before: string;
  after: string;
} {
  let start = 0;
  for (let i = 0; i < cloze.before.length; i++) {
    const ch = cloze.before[i];
    if (ch === "\n" || isJaSentenceEnd(ch)) start = i + 1;
  }
  let end = cloze.after.length;
  for (let i = 0; i < cloze.after.length; i++) {
    const ch = cloze.after[i];
    if (ch === "\n") {
      end = i;
      break;
    }
    if (isJaSentenceEnd(ch)) {
      end = i + 1;
      break;
    }
  }
  return { before: cloze.before.slice(start).replace(/^\s+/, ""), after: cloze.after.slice(0, end) };
}

/** Phrase (trou comblé) contenant le cloze, tronquée à ses bornes de phrase. */
export function clozeSentence(cloze: { before: string; after: string }, answer: string): string {
  const { before, after } = clozeSentenceParts(cloze);
  return (before + answer + after).trim();
}

/**
 * Traduction FR à la demande d'une phrase de contexte (bouton « Traduire » de la
 * correction). Mémorisée sur l'item vocab quand la phrase est son exemple, pour ne
 * traduire qu'une fois. Renvoie null si le Worker ne produit rien d'exploitable.
 */
export async function translateExampleFr(ja: string, ex: Exercise): Promise<string | null> {
  const { sentences } = await generateStoryTranslation([ja], 5);
  const fr = sentences[0]?.trim();
  if (!fr) return null;
  if (ex.track === "vocab") {
    const v = await getVocab(ex.id);
    if (v?.example?.ja && v.example.ja.trim() === ja.trim() && !v.example.fr) {
      v.example = { ja: v.example.ja, fr };
      await putVocab(v);
    }
  }
  return fr;
}

/** Note FSRS → action de statut vocab (pour les exercices notés via `applyStatus`). */
const GRADE_TO_STATUS: Record<SrsGrade, StatusAction> = {
  again: "forgot",
  hard: "review",
  good: "review",
  easy: "known",
};

/** Note un exercice et replanifie via FSRS. Crée l'item SRS s'il n'existe pas encore. */
export async function gradeExercise(
  ex: Exercise,
  grade: SrsGrade,
  now: Date = new Date(),
): Promise<void> {
  // Reconstruction issue du Lecteur (sans compétence ciblée) : note les MOTS de la
  // phrase individuellement. Une dictée (skill "oral") passe par la voie normale et
  // replanifie la carte de sa compétence.
  if (ex.mode === "build" && ex.track === "vocab" && !ex.skill) {
    await Promise.all(
      ex.tokens.filter(isContent).map((t) => applyStatus(t, grade === "again" ? "forgot" : "review", now)),
    );
    return;
  }

  // Exercice mono-mot dérivé d'une histoire (lecture d'un kanji, choix du kanji d'un mot
  // FR) : reconnaissance ÉCRITE. On note via `applyStatus`, qui crée l'item vocab s'il
  // n'existe pas encore — les mots d'histoire ne sont pas forcément déjà en base.
  if (ex.track === "vocab" && ex.token && (ex.skill ?? "written") === "written") {
    await applyStatus(ex.token, GRADE_TO_STATUS[grade], now);
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
    // « Facile » = l'utilisateur déclare maîtriser (compté dans la maîtrise de la leçon),
    // comme pour le vocab écrit ci-dessus.
    c.status = grade === "easy" ? "known" : "review";
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
    // « Facile » = l'utilisateur déclare maîtriser (compté dans la maîtrise de la leçon),
    // comme pour le vocab écrit ci-dessus.
    g.status = grade === "easy" ? "known" : "review";
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
