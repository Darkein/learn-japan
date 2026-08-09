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
  getDB,
  getGrammar,
  getSrsDaily,
  getVocab,
  localDateString,
  putGrammar,
  putVocab,
} from "./db";
import type { GrammarItem, VocabItem } from "./db";
import { gradeExercise, type Exercise } from "./exercise";
import {
  grammarReviewExercise,
  vocabDictationExercise,
  vocabListenMeaningExercise,
  vocabTriangleExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { getCurriculum, getCurriculumEntry, type CurriculumEntry } from "./curriculum";
import { isDue, newCard, State, type Card, type SrsGrade } from "./srs";
import { normalizeReading } from "./kana";
import { SRS } from "./config";
import { shuffle } from "./random";
import { loadSettings } from "./settings";
import { effectiveNewPerDay, loadTuning } from "./tuning";
import { leechIds as leechIdsFromReviews } from "./stats";
import { effectiveExample, repairConjugatedVocab } from "./vocab";

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

async function leechIds(): Promise<Set<string>> {
  const db = await getDB();
  return leechIdsFromReviews(await db.getAll("reviews"));
}

/**
 * Item testable en saisie : un sens FR exploitable, ou une graphie ≠ lecture. Sinon
 * (mot kana sans sens) le front de l'exercice EST la réponse — recopie sans intérêt.
 */
export function isTrainableVocab(v: VocabItem): boolean {
  return (!!v.meaning && v.meaning !== "—") || normalizeReading(v.surface) !== normalizeReading(v.reading);
}

export interface SessionStats {
  dueCount: number;
  newCount: number;
}

export async function sessionStats(now: Date = new Date()): Promise<SessionStats> {
  const [vocab, grammar] = await Promise.all([allVocab(), allGrammar()]);
  // +15 min : inclut les cartes dues imminentes (step relearning FSRS = 10 min)
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);
  let dueCount = 0;
  let newCount = 0;
  for (const v of vocab) {
    if (!isTrainableVocab(v)) continue;
    const c = v.cards.written;
    if (c) { if (isDue(c, horizon)) dueCount++; }
    else newCount++;
    // Compétences écoute et production : cartes dédiées, planifiées indépendamment.
    // Une carte orale n'est servable qu'avec une phrase d'exemple (même filtre que
    // buildSessionDue) — sinon le backlog affiché surestime la session réelle.
    if (v.cards.oral && isDue(v.cards.oral, horizon) && effectiveExample(v)?.ja) dueCount++;
    if (v.cards.production && isDue(v.cards.production, horizon)) dueCount++;
  }
  for (const g of grammar) {
    if (g.card) { if (isDue(g.card, horizon)) dueCount++; }
    else newCount++;
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

  // Hygiène des stores avant de construire : formes conjuguées stockées en surface
  // (révisions FR → JA qui exigeaient « し » pour faire) et piste compréhension retirée.
  await repairConjugatedVocab();
  await purgeComprehension();

  // Les éléments difficiles sont connus AVANT la construction : un leech repasse au QCM
  // même s'il avait atteint le seuil de saisie (cf. pickInputMode).
  const leeches = await leechIds();

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

/** Leçons commencées, dans l'ordre du curriculum (pour prioriser leurs objectifs). */
async function startedCurriculumEntries(): Promise<CurriculumEntry[]> {
  const progress = await allLessonProgress();
  const started = new Set(progress.filter((p) => p.startedAt).map((p) => p.id));
  return getCurriculum().filter((e) => started.has(e.id));
}

/**
 * Ordre de promotion des NOUVEAUX items de vocabulaire : d'abord les objectifs des leçons
 * commencées (dans l'ordre du curriculum), puis le vocabulaire incident des histoires.
 * Sans cela, l'ordre des clés IndexedDB (alphabétique) décidait quels mots entraient en
 * rotation — les mots-cibles d'une leçon pouvaient passer après un mot croisé au hasard.
 */
function prioritizeNewVocab(vocabAll: VocabItem[], started: CurriculumEntry[]): VocabItem[] {
  const byId = new Map(vocabAll.filter((v) => !v.cards.written).map((v) => [v.id, v]));
  const ordered: VocabItem[] = [];
  for (const entry of started) {
    for (const id of entry.introduces.vocab) {
      const v = byId.get(id);
      if (v) {
        ordered.push(v);
        byId.delete(id);
      }
    }
  }
  ordered.push(...byId.values());
  return ordered;
}

/** Même priorisation pour la grammaire : points des leçons commencées d'abord. */
function prioritizeNewGrammar(grammarAll: GrammarItem[], started: CurriculumEntry[]): GrammarItem[] {
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
  ordered.push(...byId.values());
  return ordered;
}

export type OralVariant = "type" | "meaning" | "dictation";

/**
 * Variante d'écoute pour une carte orale : rotation déterministe sur le nombre de
 * révisions déjà faites (dictée d'abord type, puis QCM de sens, puis dictée complète).
 */
export function pickOralVariant(card: Card): OralVariant {
  const variants: OralVariant[] = ["type", "meaning", "dictation"];
  return variants[card.reps % variants.length];
}

/**
 * Exercice d'écoute d'une carte orale due : la variante choisie retombe sur la dictée
 * de mot (type) si elle n'est pas constructible (pas de sens exploitable, pas assez de
 * distracteurs, phrase trop longue pour l'oreille…).
 */
async function oralExercise(v: VocabItem, card: Card, pool: VocabItem[]): Promise<Exercise> {
  const due = card.due.getTime();
  const variant = pickOralVariant(card);
  if (variant === "meaning") {
    const ex = vocabListenMeaningExercise(v, due, pool);
    if (ex) return ex;
  } else if (variant === "dictation") {
    // Tokenisation ratée (dictionnaire kuromoji indisponible…) → repli, pas d'échec de session.
    const ex = await vocabDictationExercise(v, due).catch(() => null);
    if (ex) return ex;
  }
  return vocabTypeExercise(v, due, { listen: true });
}

/**
 * Fabrique de cartes du triangle. `vocabTriangleExercise` tire la direction et met à jour
 * `v.lastDir` EN MÉMOIRE ; la persistance est différée à `flush`, qui n'écrit que les mots
 * dont la carte a survécu au plafond de session — sinon un mot jamais montré consommerait
 * quand même sa direction, et le tirage suivant l'éviterait pour rien.
 */
function triangleFactory(pool: VocabItem[], leeches: Set<string>) {
  const pending = new Map<string, VocabItem>();
  return {
    build(v: VocabItem, due: number): Exercise {
      const ex = vocabTriangleExercise(v, due, pool, { isLeech: leeches.has(v.id) });
      pending.set(ex.key, v);
      return ex;
    },
    async flush(kept: Exercise[]): Promise<void> {
      const items = kept.map((ex) => pending.get(ex.key)).filter((v): v is VocabItem => !!v);
      await Promise.all(items.map((v) => putVocab(v)));
    },
  };
}

async function buildSessionDue(now: Date, leeches: Set<string>): Promise<Exercise[]> {
  const s = loadSettings();
  // Signal d'auto-réglage : la rétention mesurée module le débit de nouveautés (le backlog,
  // lui, est mesuré plus bas sur les items dus de CETTE session). Voir lib/tuning.ts.
  const tuning = await loadTuning();
  const due: Exercise[] = [];
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);

  // Un seul chargement de chaque store (réutilisé par les passes dues / écoute / nouveaux).
  const [vocabAll, grammarAll] = await Promise.all([allVocab(), allGrammar()]);
  // Le pool de distracteurs, c'est tout le vocabulaire connu : un QCM tire ses options
  // sur la même face que la réponse (cf. faceDistractors).
  const triangle = triangleFactory(vocabAll, leeches);

  // Collecte items dus (avec carte FSRS)
  for (const v of vocabAll) {
    if (!isTrainableVocab(v)) continue;
    const c = v.cards.written;
    if (c && isDue(c, horizon)) due.push(triangle.build(v, c.due.getTime()));
  }
  for (const g of grammarAll) {
    if (g.card && isDue(g.card, horizon)) {
      due.push(await grammarReviewExercise(g, g.card.due.getTime()));
    }
  }

  // Écoute — compétence dédiée (`cards.oral`), planifiée indépendamment de l'écrit :
  // un mot n'est plus noté deux fois sur la même carte dans une session. Les cartes
  // écoute DUES passent d'abord ; puis on amorce l'écoute de quelques mots déjà
  // stabilisés à l'écrit (état Review) qui ont une phrase d'exemple.
  let listenCount = 0;
  for (const v of vocabAll) {
    if (listenCount >= SRS.listenMax) break;
    if (v.cards.oral && isDue(v.cards.oral, horizon) && effectiveExample(v)?.ja) {
      // Mode sans le son : remplacement écrit, toujours noté sur la carte orale.
      due.push(
        s.silentReviews
          ? vocabTypeExercise(v, v.cards.oral.due.getTime(), { listen: true, silent: true })
          : await oralExercise(v, v.cards.oral, vocabAll),
      );
      listenCount++;
    }
  }

  // Production en contexte — carte dédiée (`cards.production`), même logique que l'écoute :
  // les cartes dues d'abord, plafonnées par session.
  let prodCount = 0;
  for (const v of vocabAll) {
    if (prodCount >= SRS.prodMax) break;
    const c = v.cards.production;
    if (c && isDue(c, horizon)) {
      due.push(vocabTypeExercise(v, c.due.getTime(), { produce: true }));
      prodCount++;
    }
  }

  // Plafond de session : items dus triés par urgence, coupés à `sessionCap`. Le reste
  // attendra la session suivante — mieux qu'une session-fleuve après quelques jours
  // d'absence. Les amorces (écoute) et les nouveautés ne prennent que la place restante.
  due.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  const out: Exercise[] = due.slice(0, SRS.sessionCap);
  let room = SRS.sessionCap - out.length;

  // Sans le son, on n'amorce pas de NOUVELLES cartes d'écoute (les dues, elles, passent
  // en remplacement écrit ci-dessus).
  let listenSeeds = 0;
  for (const v of vocabAll) {
    if (s.silentReviews) break;
    if (room <= 0 || listenCount >= SRS.listenMax || listenSeeds >= SRS.listenSeeds) break;
    const example = effectiveExample(v);
    if (!v.cards.oral && example?.ja && v.cards.written?.state === State.Review) {
      const card = newCard(now);
      v.cards.oral = card;
      await putVocab(v);
      out.push(vocabTypeExercise(v, card.due.getTime(), { listen: true }));
      listenCount++;
      listenSeeds++;
      room--;
    }
  }

  // Amorçage production : mots STABLES à l'écrit (Review + intervalle de déblocage, plus
  // exigeant que l'amorçage écoute) avec une phrase d'exemple. Le gate d'intervalle
  // décale la production derrière l'écoute — pas deux nouvelles cartes le même jour.
  let prodSeeds = 0;
  for (const v of vocabAll) {
    if (room <= 0 || prodCount >= SRS.prodMax || prodSeeds >= SRS.prodSeeds) break;
    if (
      !v.cards.production &&
      effectiveExample(v)?.ja &&
      v.cards.written?.state === State.Review &&
      v.cards.written.scheduled_days >= SRS.unlockIntervalDays
    ) {
      const card = newCard(now);
      v.cards.production = card;
      await putVocab(v);
      out.push(vocabTypeExercise(v, card.due.getTime(), { produce: true }));
      prodCount++;
      prodSeeds++;
      room--;
    }
  }

  // Budget nouveaux items — débit auto-réglé : la rétention mesurée et le retard dû du jour
  // (backlog = items dus de cette session) rabotent `newPerDay` quand l'utilisateur peine ou
  // accumule, pour consolider plutôt qu'empiler du neuf. Voir lib/tuning.ts.
  const dateStr = localDateString(now);
  const daily = await getSrsDaily(dateStr);
  const newCap = effectiveNewPerDay(s.newPerDay, tuning.measuredRetention, due.length);
  const budget = Math.max(0, newCap - (daily?.introduced ?? 0));

  if (out.length < s.dailyGoal && budget > 0 && room > 0) {
    const newCards: Exercise[] = [];
    const toPromote = Math.max(0, Math.min(budget, s.dailyGoal - out.length, room));
    const started = await startedCurriculumEntries();

    // Vocab sans carte — objectifs des leçons commencées d'abord, incidents ensuite.
    for (const v of prioritizeNewVocab(vocabAll, started)) {
      if (newCards.length >= toPromote) break;
      if (!isTrainableVocab(v)) continue;
      const card = newCard(now);
      v.cards.written = card;
      await bumpSrsDaily(dateStr, { introduced: 1 });
      newCards.push(triangle.build(v, card.due.getTime()));
    }

    // Grammaire sans carte — même priorisation.
    if (newCards.length < toPromote) {
      for (const g of prioritizeNewGrammar(grammarAll, started)) {
        if (newCards.length >= toPromote) break;
        const card = newCard(now);
        g.card = card;
        await putGrammar(g);
        await bumpSrsDaily(dateStr, { introduced: 1 });
        newCards.push(await grammarReviewExercise(g, card.due.getTime()));
      }
    }

    out.push(...newCards);
  }

  // Le tri par urgence ci-dessus sert à CHOISIR les items qui tiennent dans la session ;
  // il ne doit pas dicter l'ordre de passage. Sans mélange, les échéances (identiques pour
  // toutes les cartes neuves) retombent sur l'ordre des clés IndexedDB : mêmes mots dans
  // la même séquence, session après session.
  const deck = shuffle(out);
  await triangle.flush(deck);
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
  const triangle = triangleFactory(await allVocab(), leeches);

  // Vocab
  for (const id of vocabIds) {
    const v = await getVocab(id);
    if (!v || !isTrainableVocab(v)) continue;
    if (!v.cards.written) v.cards.written = newCard(now);
    out.push(triangle.build(v, v.cards.written.due.getTime()));
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
  await triangle.flush(deck);
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
  const triangle = triangleFactory(pool, leeches);
  const byId = new Map(pool.map((v) => [v.id, v]));

  const out: Exercise[] = [];
  for (const id of vocabIds) {
    const v = byId.get(id);
    if (!v || !isTrainableVocab(v)) continue;
    out.push(triangle.build(v, v.cards.written?.due.getTime() ?? now.getTime()));
  }

  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (g) out.push(await grammarReviewExercise(g, g.card?.due.getTime() ?? now.getTime()));
  }

  const deck = shuffle(out).slice(0, SRS.sessionAllCap);
  await triangle.flush(deck);
  return deck;
}

/** Note un exercice d'échauffement et replanifie via FSRS. */
export async function gradeCard(ex: Exercise, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  await gradeExercise(ex, grade, now);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
