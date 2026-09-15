// Échauffement de révision (SPEC §5) : les éléments SRS dus, toutes pistes confondues,
// triés par urgence — recall rapide avant la lecture. Tous les exercices exigent un input
// (QCM, saisie, ou construction) ; voir lib/exercise.ts.

import {
  allComprehension,
  allGrammar,
  allLessonProgress,
  allVocab,
  bumpSrsDaily,
  deleteComprehensionItem,
  getGrammar,
  getSrsDaily,
  getVocab,
  localDateString,
  putGrammar,
  putVocab,
} from "./db";
import type { GrammarItem, VocabItem } from "./db";
import { gradeExercise, type Exercise } from "./exercise";
import { buildDrill, grammarReviewExercise, vocabTriangleExercise, vocabTypeExercise } from "./exerciseBuild";
import { getCurriculum, getCurriculumEntry, type CurriculumEntry } from "./curriculum";
import { isDue, newCard, type SrsGrade } from "./srs";
import { SRS } from "./config";
import { shuffle } from "./random";
import { isSilentMode, loadSettings } from "./settings";
import { effectiveNewPerDay, loadTuning } from "./tuning";
import { loadLeechIds } from "./leech";
import { effectiveExample, mergeSkillCards, purgeIncidentalCards, purgeNameVocab, repairConjugatedVocab } from "./vocab";
import { isTrainableVocab } from "./vocabFaces";
import { orderDrills } from "./vocabDrills";

export interface SessionOpts {
  /** "due" = révision SRS globale plafonnée (défaut). "all" = entraînement immédiat toute
   *  la leçon. "story" = les mots d'un texte lu, hors planification. */
  scope?: "due" | "all" | "story";
  /** Si fourni et scope="all", filtre sur les ids introduces de cette leçon. */
  lessonId?: string;
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
  newCount: number;
}

/**
 * Taille d'un bloc de révision, en cartes. L'objectif quotidien est un OBJECTIF EN CARTES
 * (« Objectif quotidien (cartes) » dans les réglages) : un bloc s'arrête donc à ce qu'il
 * reste à faire pour l'atteindre, et pas au plafond dur. Sans ça, un réglage de 10 servait
 * quand même des sessions de `sessionCap` (30) : trois fois la dose demandée, et le flux
 * n'arrivait jamais aux étapes suivantes (lecture, cours, contrôle).
 *
 * Objectif déjà atteint → un bloc PLEIN de plus : c'est le renforcement du flux, facultatif,
 * qui consolide le retard restant. `SRS.sessionCap` reste le plafond dur — un objectif de
 * 200 cartes ne produit pas une session-fleuve.
 */
export function reviewBlockSize(dailyGoal: number, reviewedToday: number): number {
  const remaining = dailyGoal - reviewedToday;
  return Math.max(1, Math.min(SRS.sessionCap, remaining > 0 ? remaining : dailyGoal));
}

export async function sessionStats(now: Date = new Date()): Promise<SessionStats> {
  const [vocab, grammar, started] = await Promise.all([
    allVocab(),
    allGrammar(),
    startedCurriculumEntries(),
  ]);
  // Les nouveautés annoncées sont celles que la session peut RÉELLEMENT promouvoir : les
  // objectifs des leçons commencées (cf. newVocabToPromote). Le vocabulaire incident d'une
  // histoire est en base sans carte lui aussi — le compter gonflerait le chiffre de mots
  // qui n'entreront jamais en rotation tout seuls.
  const promotableVocab = new Set(started.flatMap((e) => e.introduces.vocab));
  const promotableGrammar = new Set(started.flatMap((e) => e.introduces.grammar));
  // +15 min : inclut les cartes dues imminentes (step relearning FSRS = 10 min)
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);
  let dueCount = 0;
  let newCount = 0;
  for (const v of vocab) {
    if (!isTrainableVocab(v)) continue;
    // Une carte par mot : un mot dû, c'est un exercice — le type servi (écrit, écoute,
    // production) est tiré à la construction et ne change pas le compte.
    if (v.card) { if (isDue(v.card, horizon)) dueCount++; }
    else if (promotableVocab.has(v.id)) newCount++;
  }
  for (const g of grammar) {
    if (g.card) { if (isDue(g.card, horizon)) dueCount++; }
    else if (promotableGrammar.has(g.id)) newCount++;
  }
  return { dueCount, newCount };
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
  } else {
    exercises = await buildSessionDue(now, leeches);
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

/** Leçons commencées, dans l'ordre du curriculum (pour prioriser leurs objectifs). */
async function startedCurriculumEntries(): Promise<CurriculumEntry[]> {
  const progress = await allLessonProgress();
  const started = new Set(progress.filter((p) => p.startedAt).map((p) => p.id));
  return getCurriculum().filter((e) => started.has(e.id));
}

/**
 * NOUVEAUX items de vocabulaire promus par la révision : UNIQUEMENT les objectifs des
 * leçons commencées, dans l'ordre du curriculum (il est curé).
 *
 * Le vocabulaire INCIDENT — les mots croisés dans une histoire ou un article, matérialisés
 * en base par `enrollStory` / `ensureVocabItems` — n'entre JAMAIS en rotation tout seul :
 * une histoire de leçon contient des dizaines de mots hors objectifs, et les promouvoir
 * automatiquement noyait les mots-cibles de la leçon sous du vocabulaire jamais choisi.
 * Un mot incident entre en planification quand l'utilisateur le décide DEPUIS le texte, et
 * ces chemins créent la carte eux-mêmes : tap du Lecteur (`applyStatus`), exercices de
 * l'histoire (`gradeExercise`), suggestion de la fiche kanji (`addInventoryWordToReview`).
 */
function newVocabToPromote(vocabAll: VocabItem[], started: CurriculumEntry[]): VocabItem[] {
  const byId = new Map(vocabAll.filter((v) => !v.card).map((v) => [v.id, v]));
  const ordered: VocabItem[] = [];
  for (const entry of started) {
    for (const id of entry.introduces.vocab) {
      const v = byId.get(id);
      if (v) {
        ordered.push(v);
        byId.delete(id); // un même mot peut être objectif de deux leçons
      }
    }
  }
  return ordered;
}

/** Même règle pour la grammaire : seuls les points des leçons commencées sont promus. */
function newGrammarToPromote(grammarAll: GrammarItem[], started: CurriculumEntry[]): GrammarItem[] {
  const byId = new Map(grammarAll.filter((g) => !g.card).map((g) => [g.id, g]));
  const ordered: GrammarItem[] = [];
  for (const entry of started) {
    for (const id of entry.introduces.grammar) {
      const g = byId.get(id);
      if (g) {
        ordered.push(g);
        byId.delete(id);
      }
    }
  }
  return ordered;
}

/**
 * Fabrique d'exercices de vocabulaire. Deux façons de servir un mot :
 *
 *  - `drill` (révision SRS) — la FORME est tirée parmi les cinq du répertoire
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
 * Promeut jusqu'à `slots` NOUVEAUX items : objectifs des leçons commencées (vocabulaire
 * d'abord, puis grammaire), carte FSRS créée et compteur du jour incrémenté. Renvoie leurs
 * exercices — moins que `slots` s'il n'y a plus rien à introduire.
 */
async function promoteNew(
  slots: number,
  vocabAll: VocabItem[],
  grammarAll: GrammarItem[],
  make: ReturnType<typeof exerciseFactory>,
  dateStr: string,
  now: Date,
): Promise<Exercise[]> {
  const out: Exercise[] = [];
  const started = await startedCurriculumEntries();

  // Vocab sans carte — objectifs des leçons commencées, à l'exclusion de l'incident.
  // Première rencontre : toujours l'écrit (`orderDrills` n'ouvrirait de toute façon rien
  // d'autre sur une carte neuve), on ne fait pas écouter un mot jamais vu.
  for (const v of newVocabToPromote(vocabAll, started)) {
    if (out.length >= slots) break;
    if (!isTrainableVocab(v)) continue;
    const card = newCard(now);
    v.card = card;
    await bumpSrsDaily(dateStr, { introduced: 1 });
    out.push(make.triangle(v, card.due.getTime()));
  }

  // Grammaire sans carte — même règle.
  for (const g of newGrammarToPromote(grammarAll, started)) {
    if (out.length >= slots) break;
    const card = newCard(now);
    g.card = card;
    await putGrammar(g);
    await bumpSrsDaily(dateStr, { introduced: 1 });
    out.push(await grammarReviewExercise(g, card.due.getTime()));
  }
  return out;
}

async function buildSessionDue(now: Date, leeches: Set<string>): Promise<Exercise[]> {
  const s = loadSettings();
  // Sans le son : réglage permanent OU pause « je ne peux pas écouter » encore en cours.
  // Le tirage de forme écarte alors l'écoute — inutile de la construire pour la remplacer.
  const silent = isSilentMode(s, now);
  // Signal d'auto-réglage : la rétention mesurée module le débit de nouveautés (le retard,
  // lui, est mesuré plus bas sur les items dus de CETTE session). Voir lib/tuning.ts.
  const tuning = await loadTuning();
  const due: Exercise[] = [];
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);

  // Un seul chargement de chaque store (réutilisé par les passes dues et nouveaux).
  const [vocabAll, grammarAll] = await Promise.all([allVocab(), allGrammar()]);
  // Le pool de distracteurs, c'est tout le vocabulaire connu : un QCM tire ses options
  // sur la même face que la réponse (cf. faceDistractors).
  const make = exerciseFactory(vocabAll, leeches, { silent });

  // Items dus. Un mot = UNE carte = UN exercice : plus de passes séparées par compétence,
  // plus de mot écarté parce qu'il passait déjà sous un autre angle. La forme (écrit,
  // écoute, dictée, production) est tirée mot par mot — c'est ce qui donne la variété que
  // les trois cartes obtenaient en multipliant les passages.
  for (const v of vocabAll) {
    if (!isTrainableVocab(v)) continue;
    if (v.card && isDue(v.card, horizon)) due.push(await make.drill(v, v.card.due.getTime()));
  }
  for (const g of grammarAll) {
    if (g.card && isDue(g.card, horizon)) {
      due.push(await grammarReviewExercise(g, g.card.due.getTime()));
    }
  }

  const dateStr = localDateString(now);
  const daily = await getSrsDaily(dateStr);

  // Taille du bloc : ce qu'il reste à faire pour atteindre l'objectif du jour (cf.
  // `reviewBlockSize`), plafonnée à `sessionCap`. Le dû qui dépasse attendra le bloc
  // suivant — renforcement du flux, ou demain : mieux qu'une session-fleuve après
  // quelques jours d'absence.
  const cap = reviewBlockSize(s.dailyGoal, daily?.reviewed ?? 0);

  // Budget nouveaux items — débit auto-réglé (lib/tuning.ts) : `newPerDay` est un plafond
  // SOUHAITÉ, plafonné à son tour par ce que l'objectif du jour peut absorber (un mot neuf
  // demande ~`NEW_ITEM_LOAD` révisions dans ses premiers mois), puis raboté par la rétention
  // mesurée et le retard dû du jour (backlog = items dus de cette session), exprimé en
  // JOURS d'objectif.
  //
  // Sans le plafond de capacité, 10 mots neufs par jour sur un objectif de 10 cartes
  // faisaient croître le retard indéfiniment : l'utilisateur voyait « à consolider » monter
  // de plusieurs unités chaque jour sans jamais pouvoir revenir à zéro.
  //
  // Ce n'est PAS un gel par l'objectif du jour (« pas de neuf tant que le dû remplit le
  // bloc ») : celui-là bloquait toute progression dès le moindre retard — les objectifs de
  // la leçon en cours n'obtenaient jamais de carte, sa part d'items stabilisés ne montait
  // plus, son contrôle ne s'ouvrait pas, et la leçon suivante restait verrouillée. Ici le
  // débit garde un plancher d'un mot par jour tant que le retard reste sous le palier de
  // coupure ; la coupure elle-même est temporaire, et se lève dès que le retard s'est vidé.
  const newCap = effectiveNewPerDay(
    s.newPerDay,
    tuning.measuredRetention,
    due.length,
    s.dailyGoal,
  );
  const budget = Math.max(0, newCap - (daily?.introduced ?? 0));
  // Réserve de nouveautés DANS le bloc : au plus la moitié tant qu'il reste du dû (le
  // retard doit avancer aussi), tout le bloc quand il n'y a rien à revoir.
  const newSlots = Math.min(budget, due.length > 0 ? Math.floor(cap / 2) : cap);

  // Les nouveautés sont promues AVANT de découper le dû : une réserve non consommée
  // (plus rien à introduire aujourd'hui, aucune leçon commencée) revient au retard, elle
  // ne laisse pas un bloc à moitié vide.
  const newCards =
    newSlots > 0 ? await promoteNew(newSlots, vocabAll, grammarAll, make, dateStr, now) : [];

  // Items dus triés par urgence, coupés à la place qui reste dans le bloc.
  due.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  const out: Exercise[] = [...due.slice(0, cap - newCards.length), ...newCards];

  // Le tri par urgence ci-dessus sert à CHOISIR les items qui tiennent dans la session ;
  // il ne doit pas dicter l'ordre de passage. Sans mélange, les échéances (identiques pour
  // toutes les cartes neuves) retombent sur l'ordre des clés IndexedDB : mêmes mots dans
  // la même séquence, session après session.
  const deck = shuffle(out);
  await make.flush(deck);
  return deck;
}

async function buildSessionAll(
  lessonId: string,
  now: Date,
  leeches: Set<string>,
): Promise<Exercise[]> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return [];

  const out: Exercise[] = [];
  const { vocab: vocabIds, grammar: grammarIds } = entry.introduces;
  // Distracteurs tirés dans TOUT le vocabulaire connu, pas seulement la leçon : quatre
  // options venues des seuls mots du jour se devinent par élimination.
  const make = exerciseFactory(await allVocab(), leeches);

  // Vocab
  for (const id of vocabIds) {
    const v = await getVocab(id);
    if (!v || !isTrainableVocab(v)) continue;
    if (!v.card) v.card = newCard(now);
    out.push(make.triangle(v, v.card.due.getTime()));
  }

  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (!g) continue;
    if (!g.card) {
      g.card = newCard(now);
      await putGrammar(g);
    }
    out.push(await grammarReviewExercise(g, g.card!.due.getTime()));
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
