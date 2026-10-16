// Séances d'exercices (SPEC §5) : les étapes du parcours (Vocabulaire, Grammaire, Révision,
// Produire), l'entraînement libre sur une leçon et les exercices d'une histoire. Tous les
// exercices exigent un input (QCM, saisie, ou construction) ; voir lib/exercise.ts.


import {
  allComprehension,
  allGrammar,
  allVocab,
  bumpSrsDaily,
  deleteComprehensionItem,
  getGrammar,
  getVocab,
  localDateString,
  putGrammar,
  putVocab,
} from "./db";
import type { VocabItem } from "./db";
import { gradeExercise, type Exercise } from "./exercise";
import {
  buildDrill,
  grammarBuildExercise,
  grammarChoiceExercise,
  grammarReviewExercise,
  vocabListenMeaningExercise,
  vocabTriangleExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { getCurriculumEntry } from "./curriculum";
import { enrollLesson } from "./enroll";
import { isPreAcquiredGrammar, isPreAcquiredVocab, REVIEW_STEP_SIZE } from "./path";
import { isDue, newCard, retrievability, State, type Card, type SrsGrade } from "./srs";
import { SRS } from "./config";
import { shuffle } from "./random";
import { isSilentMode, loadSettings } from "./settings";
import { loadLeechIds } from "./leech";
import { effectiveExample, mergeSkillCards, purgeIncidentalCards, purgeNameVocab, repairConjugatedVocab } from "./vocab";
import { isTrainableVocab } from "./vocabFaces";
import { orderDrills } from "./vocabDrills";

/** Étapes du parcours qui sont des séances d'exercices sur les éléments d'une leçon. */
export type LessonStepScope = "vocab" | "grammar" | "produce";

export interface SessionOpts {
  /** "due" = étape Révision du parcours (défaut). "step" = séance d'une étape de leçon
   *  (Vocabulaire, Grammaire, Produire). "all" = entraînement libre sur toute la leçon.
   *  "story" = les mots d'un texte lu, hors planification. */
  scope?: "due" | "all" | "story" | "step";
  /** Leçon visée (scopes "all" et "step"). */
  lessonId?: string;
  /** scope "step" : l'étape de la leçon. */
  step?: LessonStepScope;
  /** scope "due" : révision CIBLÉE sur ces éléments (ex. les ratés d'un contrôle). */
  itemIds?: string[];
  /** scope "story" : ids des mots (`itemIdFor`) et des points de grammaire du texte. */
  vocabIds?: string[];
  grammarIds?: string[];
}

// Défini avec les faces du triangle (lib/vocabFaces.ts) — c'est la même notion, et les
// constructeurs d'exercices en ont besoin sans dépendre de ce module. Réexporté ici : c'est
// la session qui en fait le filtre d'entrée de toutes ses passes.
export { isTrainableVocab } from "./vocabFaces";

export interface SessionStats {
  dueCount: number;
  /** Cartes en rotation, dues ou non : une étape Révision a de quoi servir dès qu'il y en a. */
  cardCount: number;
}

export async function sessionStats(now: Date = new Date()): Promise<SessionStats> {
  const [vocab, grammar] = await Promise.all([allVocab(), allGrammar()]);
  // +15 min : inclut les cartes dues imminentes (step relearning FSRS = 10 min)
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);
  let dueCount = 0;
  let cardCount = 0;
  for (const v of vocab) {
    if (!isTrainableVocab(v) || !v.card) continue;
    // Une carte par mot : un mot dû, c'est un exercice — le type servi (écrit, écoute,
    // production) est tiré à la construction et ne change pas le compte.
    cardCount++;
    if (isDue(v.card, horizon)) dueCount++;
  }
  for (const g of grammar) {
    if (!g.card) continue;
    cardCount++;
    if (isDue(g.card, horizon)) dueCount++;
  }
  return { dueCount, cardCount };
}

/**
 * Purge le store de compréhension : la piste a été retirée des exercices (le QCM de
 * compréhension faisait doublon avec la carte de grammaire du même point). Sans purge, ces
 * items resteraient comptés comme dus dans les stats et le badge de révisions. Idempotent.
 */
async function purgeComprehension(): Promise<void> {
  const items = await allComprehension();
  await Promise.all(items.map((c) => deleteComprehensionItem(c.id)));
}

export async function buildSession(
  now: Date = new Date(),
  opts: SessionOpts = {},
): Promise<Exercise[]> {
  const scope = opts.scope ?? "due";

  // Hygiène des stores avant de construire : trois cartes par mot fusionnées en une seule
  // (bases d'avant le modèle « un mot, une carte »), formes conjuguées stockées en surface
  // (révisions FR → JA qui exigeaient « し » pour faire), noms croisés dans un article ou
  // inventés par une histoire (田中, クロ le chat), vocabulaire incident promu tout seul par
  // les anciennes sessions, et piste compréhension retirée.
  await mergeSkillCards();
  await repairConjugatedVocab();
  await purgeNameVocab();
  await purgeIncidentalCards();
  await purgeComprehension();

  // Les éléments difficiles sont connus AVANT la construction : un leech repasse au QCM
  // même s'il avait atteint le seuil de saisie (cf. pickInputMode).
  const leeches = await loadLeechIds();

  let exercises: Exercise[];
  if (scope === "all") {
    if (!opts.lessonId) return [];
    exercises = await buildSessionAll(opts.lessonId, now, leeches);
  } else if (scope === "story") {
    exercises = await buildSessionStory(opts.vocabIds ?? [], opts.grammarIds ?? [], now, leeches);
  } else if (scope === "step") {
    if (!opts.lessonId || !opts.step) return [];
    exercises = await buildSessionStep(opts.lessonId, opts.step, now, leeches);
  } else {
    exercises = await buildSessionReview(now, leeches, opts.itemIds);
  }

  for (const ex of exercises) {
    if (leeches.has(ex.id)) ex.isLeech = true;
  }
  return exercises;
}

/**
 * Retire le son d'une session DÉJÀ construite : chaque exercice d'écoute restant devient
 * son équivalent écrit (cloze noté sur la carte orale, comme le mode sans le son), à la
 * même place dans le deck. À appeler quand l'utilisateur déclare ne pas pouvoir écouter en
 * cours de session — révéler le texte n'a pas de sens, c'est justement la réponse.
 * Un exercice dont le mot n'est plus en base est simplement retiré (jamais de cul-de-sac).
 */
export async function silenceDeck(cards: Exercise[]): Promise<Exercise[]> {
  const out: Exercise[] = [];
  // Le remplacement écrit peut retomber sur le rappel isolé FR → mot : il lui faut le pool
  // pour accepter les mots de même sens (cf. frTwins, lib/exerciseBuild.ts).
  const pool = cards.some((ex) => ex.audio) ? await allVocab() : [];
  for (const ex of cards) {
    if (!ex.audio) {
      out.push(ex);
      continue;
    }
    const v = ex.track === "vocab" ? await getVocab(ex.id) : undefined;
    if (!v) continue;
    const written = await vocabTypeExercise(v, ex.due ?? 0, { listen: true, silent: true, pool });
    out.push(ex.isLeech ? { ...written, isLeech: true } : written);
  }
  return out;
}

/**
 * Fabrique d'exercices de vocabulaire. Deux façons de servir un mot :
 *
 *  - `drill` (étape Révision) — la FORME est tirée parmi les cinq du répertoire
 *    (lib/vocabDrills.ts), la première constructible gagne ;
 *  - `triangle` (bilan de leçon, exercices d'histoire) — toujours l'écrit : ces entrées
 *    servent des mots qui n'ont pas forcément de carte, et on y vérifie la reconnaissance.
 *
 * Les deux notent leur tirage (`lastDrill`, `lastDir`) EN MÉMOIRE sur le mot ; la
 * persistance est différée à `flush`, qui n'écrit que les mots dont l'exercice a survécu au
 * plafond de session — sinon un mot jamais montré consommerait quand même son tour de
 * rotation, et le tirage suivant l'éviterait pour rien.
 */
function exerciseFactory(pool: VocabItem[], leeches: Set<string>, ctx: { silent?: boolean } = {}) {
  const pending = new Map<string, VocabItem>();
  const remember = (ex: Exercise, v: VocabItem) => {
    pending.set(ex.key, v);
    return ex;
  };
  return {
    async drill(v: VocabItem, due: number): Promise<Exercise> {
      const isLeech = leeches.has(v.id);
      const hasExample = !!effectiveExample(v)?.ja;
      for (const kind of orderDrills(v, { silent: ctx.silent, hasExample })) {
        const ex = await buildDrill(v, kind, due, { pool, isLeech });
        if (ex) return remember(ex, v);
      }
      // Filet : `orderDrills` porte toujours l'écrit, toujours constructible.
      return remember(vocabTriangleExercise(v, due, pool, { isLeech }), v);
    },
    triangle(v: VocabItem, due: number): Exercise {
      return remember(vocabTriangleExercise(v, due, pool, { isLeech: leeches.has(v.id) }), v);
    },
    async flush(kept: Exercise[]): Promise<void> {
      const items = kept.map((ex) => pending.get(ex.key)).filter((v): v is VocabItem => !!v);
      await Promise.all(items.map((v) => putVocab(v)));
    },
  };
}

/**
 * L'étape Révision du parcours (SPEC §5.4) : `REVIEW_STEP_SIZE` cartes, les plus urgentes
 * d'abord. Quand il n'y en a pas assez de dues, elle complète avec les éléments les plus
 * FRAGILES (plus faible probabilité de rappel FSRS, les difficiles d'abord) : une étape
 * Révision n'est jamais vide tant qu'il existe des cartes, ce qui garde la séance sans fin.
 * FSRS traite une révision anticipée — elle compte, et fait moins progresser la stabilité
 * qu'une révision à l'échéance.
 *
 * `itemIds` cible la révision sur des éléments donnés (les ratés d'un contrôle) : ils sont
 * servis qu'ils soient dus ou non, sans complément.
 */
async function buildSessionReview(
  now: Date,
  leeches: Set<string>,
  itemIds?: string[],
): Promise<Exercise[]> {
  const s = loadSettings();
  // Sans le son : réglage permanent OU pause « je ne peux pas écouter » encore en cours.
  // Le tirage de forme écarte alors l'écoute — inutile de la construire pour la remplacer.
  const silent = isSilentMode(s, now);
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);

  // Un seul chargement de chaque store.
  const [vocabAll, grammarAll] = await Promise.all([allVocab(), allGrammar()]);
  // Le pool de distracteurs, c'est tout le vocabulaire connu : un QCM tire ses options
  // sur la même face que la réponse (cf. faceDistractors).
  const make = exerciseFactory(vocabAll, leeches, { silent });

  // Candidats : un mot = UNE carte = UN exercice. La forme (écrit, écoute, dictée,
  // production) est tirée mot par mot — c'est ce qui donne la variété.
  type Candidate = { card: Card; build: () => Promise<Exercise>; id: string };
  const candidates: Candidate[] = [];
  for (const v of vocabAll) {
    if (!isTrainableVocab(v) || !v.card) continue;
    const card = v.card;
    candidates.push({ card, id: v.id, build: () => make.drill(v, card.due.getTime()) });
  }
  for (const g of grammarAll) {
    if (!g.card) continue;
    const card = g.card;
    candidates.push({ card, id: g.id, build: () => grammarReviewExercise(g, card.due.getTime()) });
  }

  let chosen: Candidate[];
  if (itemIds) {
    const wanted = new Set(itemIds);
    chosen = candidates.filter((c) => wanted.has(c.id));
  } else {
    // Dus, les plus urgents d'abord ; puis les plus fragiles parmi ceux déjà travaillés
    // (une carte neuve n'a pas de mémoire à entretenir).
    const due = candidates
      .filter((c) => isDue(c.card, horizon))
      .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
    const fragile = candidates
      .filter((c) => !isDue(c.card, horizon) && c.card.state !== State.New)
      .map((c) => ({ c, r: retrievability(c.card, now), leech: leeches.has(c.id) }))
      .sort((a, b) => Number(b.leech) - Number(a.leech) || a.r - b.r)
      .map((x) => x.c);
    chosen = [...due, ...fragile].slice(0, REVIEW_STEP_SIZE);
  }

  const out: Exercise[] = [];
  for (const c of chosen) out.push(await c.build());

  // Le tri sert à CHOISIR les cartes de l'étape, pas à dicter l'ordre de passage : sans
  // mélange, les mêmes mots reviendraient dans la même séquence, étape après étape.
  const deck = shuffle(out);
  await make.flush(deck);
  return deck;
}

/** Donne sa carte FSRS à un élément qui n'en a pas encore : sa PREMIÈRE rencontre en exercice. */
async function ensureCard<T extends { card?: Card }>(item: T, now: Date): Promise<Card> {
  if (item.card) return item.card;
  item.card = newCard(now);
  await bumpSrsDaily(localDateString(now), { introduced: 1 });
  return item.card;
}

/** Clé d'exercice propre à un niveau : le même mot passe deux fois dans une étape. */
function atLevel(ex: Exercise, level: number): Exercise {
  return { ...ex, key: `${ex.key}#n${level}` };
}

/**
 * Séance d'une étape de leçon (SPEC §5.2, §5.3). Chaque élément y est servi à un niveau de
 * difficulté, et TOUS les exercices du premier niveau passent avant ceux du second : chaque
 * élément est revu après quelques autres, jamais deux fois de suite.
 *
 *  - Vocabulaire : niveau 1 (triangle en QCM) puis niveau 2 (saisie de la lecture, ou sens à
 *    l'écoute) — pour les mots pas encore acquis.
 *  - Grammaire : niveau 1 (rôle du point en QCM) puis niveau 2 (reconstruction de sa phrase
 *    d'exemple) — pour les points pas encore acquis.
 *  - Produire : niveau 3 — production du mot en contexte, reconstruction de la phrase du
 *    point de grammaire — pour TOUS les éléments de la leçon.
 *
 * Les éléments reçoivent leur carte ici, à leur première rencontre en exercice : chaque
 * réponse est notée (la première réponse compte, SPEC §5.5).
 */
async function buildSessionStep(
  lessonId: string,
  step: LessonStepScope,
  now: Date,
  leeches: Set<string>,
): Promise<Exercise[]> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return [];
  // Les éléments de la leçon existent en base dès qu'elle est commencée ; l'enrôlement est
  // idempotent et rattrape une leçon ouverte par un chemin qui ne l'a pas attendu.
  await enrollLesson(lessonId);
  const silent = isSilentMode(loadSettings(), now);
  const pool = await allVocab();
  const byId = new Map(pool.map((v) => [v.id, v]));
  const first: Exercise[] = [];
  const second: Exercise[] = [];

  if (step === "vocab" || step === "produce") {
    for (const id of entry.introduces.vocab) {
      const v = byId.get(id);
      if (!v || !isTrainableVocab(v)) continue;
      if (step === "vocab" && isPreAcquiredVocab(v)) continue;
      const card = await ensureCard(v, now);
      const due = card.due.getTime();
      const isLeech = leeches.has(v.id);
      if (step === "vocab") {
        first.push(atLevel(vocabTriangleExercise(v, due, pool, { isLeech, mode: "choice" }), 1));
        const listen =
          !silent && Math.random() < 0.5 && effectiveExample(v)?.ja
            ? vocabListenMeaningExercise(v, due, pool)
            : null;
        second.push(atLevel(listen ?? vocabTriangleExercise(v, due, pool, { isLeech, mode: "type" }), 2));
      } else {
        first.push(atLevel(await vocabTypeExercise(v, due, { produce: true, pool }), 3));
      }
      await putVocab(v);
    }
  }

  if (step === "grammar" || step === "produce") {
    for (const id of entry.introduces.grammar) {
      const g = await getGrammar(id);
      if (!g) continue;
      if (step === "grammar" && isPreAcquiredGrammar(g)) continue;
      const card = await ensureCard(g, now);
      await putGrammar(g);
      const due = card.due.getTime();
      if (step === "grammar") {
        first.push(atLevel(grammarChoiceExercise(g, due), 1));
        second.push(atLevel((await grammarBuildExercise(g, due)) ?? grammarChoiceExercise(g, due), 2));
      } else {
        first.push(atLevel((await grammarBuildExercise(g, due)) ?? grammarChoiceExercise(g, due), 3));
      }
    }
  }

  return [...shuffle(first), ...shuffle(second)];
}

async function buildSessionAll(
  lessonId: string,
  now: Date,
  leeches: Set<string>,
): Promise<Exercise[]> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return [];

  // Entraînement neutre (SPEC §5) : une carte manquante n'est qu'un repère d'échéance pour
  // le tri, jamais une carte mise en rotation — la séance n'écrit rien dans le SRS.
  const out: Exercise[] = [];
  const { vocab: vocabIds, grammar: grammarIds } = entry.introduces;
  // Distracteurs tirés dans TOUT le vocabulaire connu, pas seulement la leçon : quatre
  // options venues des seuls mots du jour se devinent par élimination.
  const make = exerciseFactory(await allVocab(), leeches);

  // Vocab
  for (const id of vocabIds) {
    const v = await getVocab(id);
    if (!v || !isTrainableVocab(v)) continue;
    out.push(make.triangle(v, (v.card ?? newCard(now)).due.getTime()));
  }

  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (!g) continue;
    out.push(await grammarReviewExercise(g, (g.card ?? newCard(now)).due.getTime()));
  }

  // Les plus urgents sont retenus, puis mélangés : le bilan reste plafonné pour rester
  // digeste, mais ne repasse pas les mêmes questions dans le même ordre.
  const deck = shuffle(out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, SRS.sessionAllCap));
  await make.flush(deck);
  return deck;
}

/**
 * Exercices d'un texte lu (Lecteur) : le MÊME format que la révision, restreint aux mots
 * du texte. Les ids attendus sont ceux d'items EXISTANTS — l'appelant matérialise d'abord
 * les mots du texte (`ensureVocabItems`). Aucune carte FSRS n'est amorcée ici : lire une
 * histoire n'introduit pas d'items dans la planification, seule la note le fait
 * (`gradeExercise`, qui crée la carte au premier passage).
 */
async function buildSessionStory(
  vocabIds: string[],
  grammarIds: string[],
  now: Date,
  leeches: Set<string>,
): Promise<Exercise[]> {
  const pool = await allVocab();
  const make = exerciseFactory(pool, leeches);
  const byId = new Map(pool.map((v) => [v.id, v]));

  const out: Exercise[] = [];
  for (const id of vocabIds) {
    const v = byId.get(id);
    if (!v || !isTrainableVocab(v)) continue;
    out.push(make.triangle(v, v.card?.due.getTime() ?? now.getTime()));
  }

  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (g) out.push(await grammarReviewExercise(g, g.card?.due.getTime() ?? now.getTime()));
  }

  // Les mots du texte sont plafonnés par URGENCE avant d'être mélangés, comme le bilan de
  // leçon. Un tirage au hasard donnait toute leur chance aux mots ultra-fréquents (私, 今日
  // sont dans presque tous les textes) alors qu'ils sont planifiés loin : ils occupaient la
  // place des mots réellement à revoir, et l'utilisateur les retrouvait à chaque lecture.
  const deck = shuffle(out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, SRS.sessionAllCap));
  await make.flush(deck);
  return deck;
}

/** Note un exercice d'échauffement et replanifie via FSRS. */
export async function gradeCard(ex: Exercise, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  await gradeExercise(ex, grade, now);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
