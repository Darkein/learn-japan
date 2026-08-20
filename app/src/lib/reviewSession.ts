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
import { isDue, newCard, SKILL_GAP_MS, State, type Card, type SrsGrade } from "./srs";
import { SRS } from "./config";
import { shuffle } from "./random";
import { isSilentMode, loadSettings } from "./settings";
import { effectiveNewPerDay, loadTuning } from "./tuning";
import { leechIds as leechIdsFromReviews } from "./stats";
import { effectiveExample, purgeNameVocab, repairConjugatedVocab } from "./vocab";
import { faceText, isTrainableVocab } from "./vocabFaces";

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

// Défini avec les faces du triangle (lib/vocabFaces.ts) — c'est la même notion, et les
// constructeurs d'exercices en ont besoin sans dépendre de ce module. Réexporté ici : c'est
// la session qui en fait le filtre d'entrée de toutes ses passes.
export { isTrainableVocab } from "./vocabFaces";

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
  // (révisions FR → JA qui exigeaient « し » pour faire), noms croisés dans un article ou
  // inventés par une histoire (田中, クロ le chat) et piste compréhension retirée.
  await repairConjugatedVocab();
  await purgeNameVocab();
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
 * Ordre de promotion des NOUVEAUX items de vocabulaire : d'abord les objectifs des leçons
 * commencées (dans l'ordre du curriculum), puis le vocabulaire incident des histoires.
 * Sans cela, l'ordre des clés IndexedDB (alphabétique) décidait quels mots entraient en
 * rotation — les mots-cibles d'une leçon pouvaient passer après un mot croisé au hasard.
 *
 * Le vocabulaire incident passe GRAPHIES EN KANJI D'ABORD : à budget de nouveautés égal,
 * un mot qui s'écrit en kanji apporte plus qu'un mot déjà lisible tel quel en kana. Les
 * objectifs de leçon, eux, gardent l'ordre du curriculum (il est curé).
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
  const incidental = [...byId.values()];
  const written = (v: VocabItem) => (faceText(v, "kanji") ? 0 : 1);
  ordered.push(...incidental.sort((a, b) => written(a) - written(b)));
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

/**
 * Repousse la carte d'une compétence secondaire écartée de la session parce que son mot y
 * passe déjà : l'échéance est décalée en BASE (`SKILL_GAP_MS`), pas seulement ignorée —
 * le badge de révisions compte les cartes dues du store, il resterait sinon bloqué sur une
 * carte que la session refuse de servir. Nettoie aussi les bases constituées avant
 * `spaceSkillCards`, dont les échéances par compétence sont encore agglutinées.
 */
async function deferSkill(v: VocabItem, skill: "oral" | "production", now: Date): Promise<void> {
  const card = v.cards[skill];
  if (!card) return;
  card.due = new Date(now.getTime() + SKILL_GAP_MS);
  await putVocab(v);
}

/**
 * Le mot a-t-il été révisé (n'importe quelle compétence) dans la fenêtre d'espacement ?
 * Sert aux AMORCES : une carte neuve est due sur-le-champ, donc amorcer l'écoute d'un mot
 * révisé à l'écrit la veille le ramène dès le lendemain — le mot n'a rien fait pour ça.
 * L'amorce n'est pas urgente, elle attend simplement une session de plus.
 */
function seenRecently(v: VocabItem, now: Date): boolean {
  const last = Math.max(
    0,
    ...Object.values(v.cards).map((c) => c?.last_review?.getTime() ?? 0),
  );
  return now.getTime() - last < SKILL_GAP_MS;
}

async function buildSessionDue(now: Date, leeches: Set<string>): Promise<Exercise[]> {
  const s = loadSettings();
  // Sans le son : réglage permanent OU pause « je ne peux pas écouter » encore en cours.
  const silent = isSilentMode(s, now);
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

  // Un mot ne passe qu'UNE fois par session, toutes compétences confondues : ses trois
  // cartes sont planifiées séparément, et les bases constituées avant `spaceSkillCards`
  // portent encore des échéances agglutinées. La carte écartée est repoussée en base
  // (`deferSkill`) plutôt que simplement sautée — sinon le badge de révisions continuerait
  // de la compter alors que la session ne la sert pas.
  const served = new Set<string>();

  // Collecte items dus (avec carte FSRS)
  for (const v of vocabAll) {
    if (!isTrainableVocab(v)) continue;
    const c = v.cards.written;
    if (c && isDue(c, horizon)) {
      due.push(triangle.build(v, c.due.getTime()));
      served.add(v.id);
    }
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
    if (v.cards.oral && isDue(v.cards.oral, horizon) && served.has(v.id)) {
      await deferSkill(v, "oral", now);
      continue;
    }
    if (v.cards.oral && isDue(v.cards.oral, horizon) && effectiveExample(v)?.ja) {
      // Mode sans le son : remplacement écrit, toujours noté sur la carte orale.
      due.push(
        silent
          ? await vocabTypeExercise(v, v.cards.oral.due.getTime(), { listen: true, silent: true, pool: vocabAll })
          : await oralExercise(v, v.cards.oral, vocabAll),
      );
      listenCount++;
      served.add(v.id);
    }
  }

  // Production en contexte — carte dédiée (`cards.production`), même logique que l'écoute :
  // les cartes dues d'abord, plafonnées par session.
  let prodCount = 0;
  for (const v of vocabAll) {
    if (prodCount >= SRS.prodMax) break;
    const c = v.cards.production;
    if (!c || !isDue(c, horizon)) continue;
    if (served.has(v.id)) {
      await deferSkill(v, "production", now);
      continue;
    }
    due.push(await vocabTypeExercise(v, c.due.getTime(), { produce: true, pool: vocabAll }));
    prodCount++;
    served.add(v.id);
  }

  // Plafond de session : items dus triés par urgence, coupés à `sessionCap`. Le reste
  // attendra la session suivante — mieux qu'une session-fleuve après quelques jours
  // d'absence. Les amorces (écoute) et les nouveautés ne prennent que la place restante.
  due.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  const out: Exercise[] = due.slice(0, SRS.sessionCap);
  let room = SRS.sessionCap - out.length;

  // Les amorces raisonnent sur le deck RÉELLEMENT retenu : un mot coupé par le plafond
  // n'a pas été servi, il n'y a pas de raison de lui refuser une amorce.
  const inDeck = new Set(out.filter((ex) => ex.track === "vocab").map((ex) => ex.id));

  // Sans le son, on n'amorce pas de NOUVELLES cartes d'écoute (les dues, elles, passent
  // en remplacement écrit ci-dessus).
  let listenSeeds = 0;
  for (const v of vocabAll) {
    if (silent) break;
    if (room <= 0 || listenCount >= SRS.listenMax || listenSeeds >= SRS.listenSeeds) break;
    const example = effectiveExample(v);
    // Jamais sur un mot déjà au programme du jour ni tout juste révisé : l'amorce ferait
    // un doublon immédiat ou un retour le lendemain (cf. seenRecently).
    if (inDeck.has(v.id) || seenRecently(v, now)) continue;
    if (!v.cards.oral && example?.ja && v.cards.written?.state === State.Review) {
      const card = newCard(now);
      v.cards.oral = card;
      await putVocab(v);
      out.push(await vocabTypeExercise(v, card.due.getTime(), { listen: true }));
      listenCount++;
      listenSeeds++;
      room--;
      inDeck.add(v.id);
    }
  }

  // Amorçage production : mots STABLES à l'écrit (Review + intervalle de déblocage, plus
  // exigeant que l'amorçage écoute) avec une phrase d'exemple. Le gate d'intervalle
  // décale la production derrière l'écoute — pas deux nouvelles cartes le même jour.
  let prodSeeds = 0;
  for (const v of vocabAll) {
    if (room <= 0 || prodCount >= SRS.prodMax || prodSeeds >= SRS.prodSeeds) break;
    if (inDeck.has(v.id) || seenRecently(v, now)) continue;
    if (
      !v.cards.production &&
      effectiveExample(v)?.ja &&
      v.cards.written?.state === State.Review &&
      v.cards.written.scheduled_days >= SRS.unlockIntervalDays
    ) {
      const card = newCard(now);
      v.cards.production = card;
      await putVocab(v);
      out.push(await vocabTypeExercise(v, card.due.getTime(), { produce: true, pool: vocabAll }));
      prodCount++;
      prodSeeds++;
      room--;
      inDeck.add(v.id);
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

  // Les mots du texte sont plafonnés par URGENCE avant d'être mélangés, comme le bilan de
  // leçon. Un tirage au hasard donnait toute leur chance aux mots ultra-fréquents (私, 今日
  // sont dans presque tous les textes) alors qu'ils sont planifiés loin : ils occupaient la
  // place des mots réellement à revoir, et l'utilisateur les retrouvait à chaque lecture.
  const deck = shuffle(out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, SRS.sessionAllCap));
  await triangle.flush(deck);
  return deck;
}

/** Note un exercice d'échauffement et replanifie via FSRS. */
export async function gradeCard(ex: Exercise, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  await gradeExercise(ex, grade, now);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
