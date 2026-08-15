// Modèle d'exercice unifié (Lecteur + Échauffement). Trois modes, tous avec INPUT :
// QCM tap (choice), saisie texte (type), construction de phrase par tuiles (build).
// Plus de mode "reveal" (auto-note sans réponse produite).

import { getGrammar, getVocab, logReview, putGrammar, putVocab, type Skill } from "./db";
import { generateStoryTranslation } from "./genClient";
import { newCard, review, spaceSkillCards, type SrsGrade } from "./srs";
import type { KuromojiToken } from "./tokenizer";
import { applyStatus, isContent } from "./vocab";

export type ExerciseTrack = "vocab" | "grammar";

export const TRACK_FR: Record<ExerciseTrack, string> = {
  vocab: "vocabulaire",
  grammar: "grammaire",
};

interface ExerciseBase {
  /** Clé stable de rendu (gère doublons). */
  key: string;
  /** Piste SRS notée. */
  track: ExerciseTrack;
  /** Compétence notée (piste vocab uniquement) : carte FSRS dédiée par compétence.
   *  Absent = "written". "oral" = écoute, planifiée indépendamment de l'écrit. */
  skill?: Skill;
  /** Id de l'item SRS (VocabItem.id | GrammarItem.id). */
  id: string;
  /** Face avant : le contenu à reconnaître (kanji, lecture, sens FR, point de grammaire,
   *  phrase) — pas une question : la consigne va dans `prompt`. */
  front: string;
  /** Correction affichée après réponse. */
  back: string;
  /** Sens FR du mot (piste vocab) : affiché en clair dans la correction d'un échec, pour
   *  revoir la traduction du mot raté quand la face avant ne la montre pas déjà. */
  meaning?: string;
  context?: string;
  /** Phrase de contexte telle qu'elle doit être PRONONCÉE : la lecture enseignée du mot
   *  cible y remplace sa graphie, que la synthèse lirait à sa façon (cf. lib/speech.ts).
   *  Absente = prononcer `context` tel quel. */
  contextSpeech?: string;
  /** Traduction FR de la phrase de contexte (affichée dans la correction). */
  contextFr?: string;
  /** Lecture audio à faire avant de répondre : phrase ou mot (Web Speech). `word` porte le
   *  texte À PRONONCER (la lecture en kana, cf. lib/speech.ts), pas la graphie affichée :
   *  hors phrase, la synthèse devine mal les kanji. */
  audio?: { word?: string; sentence?: string };
  /** Écoute proposée APRÈS la réponse (correction) quand il n'y a pas de phrase de contexte.
   *  Même convention que `audio` pour `word`. */
  audioBack?: { word?: string; sentence?: string };
  /** Exercice à l'aveugle : la face avant ne montre PAS le texte entendu (QCM de sens,
   *  dictée) — bouton « Réécouter » et échappatoire « Afficher le texte » dans la carte. */
  audioOnly?: boolean;
  /** Consigne courte affichée au-dessus de la face avant. */
  prompt?: string;
  /** Mot source d'un exercice du triangle (lib/vocabFaces.ts) : la correction en tire les
   *  furigana en ruby, la décomposition en kanji et le moyen mnémotechnique. */
  word?: { id: string; surface: string; reading: string };
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
}

export interface ChoiceExercise extends ExerciseBase {
  mode: "choice";
  choices: string[];
  answerIndex: number;
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

  if (ex.track === "vocab") {
    const v = await getVocab(ex.id);
    if (!v) return;
    const skill = ex.skill ?? "written";
    v.cards[skill] = review(v.cards[skill] ?? newCard(now), grade, now);
    // Le mot vient de passer : ses AUTRES compétences ne doivent pas retomber dans la
    // foulée (cf. spaceSkillCards). Un échec ne change rien à la règle — c'est FSRS qui
    // ramène la carte ratée, et les autres n'ont pas à l'accompagner le même jour.
    spaceSkillCards(v.cards, skill, now);
    if (skill === "written") {
      // Le statut affiché (soulignement du lecteur) reflète la reconnaissance écrite.
      v.status = grade === "easy" ? "known" : "review";
      // Suite de réussites : pilote le passage du QCM à la saisie. « Difficile » compte
      // comme une remise à zéro — c'est aussi la note d'une réponse à une coquille près,
      // et taper un mot qu'on écrit de travers n'est pas encore acquis.
      v.streak = grade === "again" || grade === "hard" ? 0 : (v.streak ?? 0) + 1;
    }
    await putVocab(v);
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
  } else {
    const item = await getGrammar(ex.id);
    return item?.card?.scheduled_days ?? 0;
  }
}
