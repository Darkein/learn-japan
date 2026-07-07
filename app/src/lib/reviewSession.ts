// Échauffement de révision (SPEC §5) : les éléments SRS dus, toutes pistes confondues,
// triés par urgence — recall rapide avant la lecture. Tous les exercices exigent un input
// (QCM, saisie, ou construction) ; voir lib/exercise.ts.

import {
  allComprehension,
  allGrammar,
  allLessonProgress,
  allVocab,
  bumpSrsDaily,
  getDB,
  getGrammar,
  getSrsDaily,
  getVocab,
  localDateString,
  putGrammar,
  putVocab,
} from "./db";
import { conjugationExercise, type DrillVerb } from "./conjugation";
import type { GrammarItem, VocabItem } from "./db";
import { gradeExercise, type Exercise } from "./exercise";
import {
  comprehensionReviewExercise,
  grammarReviewExercise,
  vocabDictationExercise,
  vocabListenMeaningExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { synthesizeText } from "./ttsClient";
import { getCurriculum, getCurriculumEntry, type CurriculumEntry } from "./curriculum";
import { isDue, newCard, State, type Card, type SrsGrade } from "./srs";
import { normalizeReading } from "./kana";
import { SRS } from "./config";
import { loadSettings } from "./settings";
import { leechIds as leechIdsFromReviews } from "./stats";
import { effectiveExample } from "./vocab";

export interface SessionOpts {
  /** "due" = révision SRS globale plafonnée (défaut). "all" = entraînement immédiat toute la leçon. */
  scope?: "due" | "all";
  /** Si fourni et scope="all", filtre sur les ids introduces de cette leçon. */
  lessonId?: string;
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
  const [vocab, grammar, comprehension] = await Promise.all([
    allVocab(), allGrammar(), allComprehension(),
  ]);
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
  for (const c of comprehension) {
    if (c.card) { if (isDue(c.card, horizon)) dueCount++; }
  }
  return { dueCount, newCount };
}

export async function buildSession(
  now: Date = new Date(),
  opts: SessionOpts = {},
): Promise<Exercise[]> {
  const scope = opts.scope ?? "due";

  let exercises: Exercise[];
  if (scope === "all") {
    if (!opts.lessonId) return [];
    exercises = await buildSessionAll(opts.lessonId, now);
  } else {
    exercises = await buildSessionDue(now);
  }

  const leeches = await leechIds();
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

/** Pool de verbes pour les drills de conjugaison : mots déjà en rotation SRS. */
function drillVerbPool(vocab: VocabItem[]): DrillVerb[] {
  return vocab
    .filter((v) => v.cards.written)
    .map((v) => ({ surface: v.surface, reading: v.reading, meaning: v.meaning }));
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
 * Exercice de révision d'un point de grammaire : drill de conjugaison (production sur un
 * verbe du pool) quand le point est une forme couverte, sinon QCM/reconstruction.
 */
async function grammarSessionExercise(
  g: GrammarItem,
  due: number,
  verbs: DrillVerb[],
): Promise<Exercise> {
  const drill = await conjugationExercise(g, verbs, due);
  return drill ?? grammarReviewExercise(g, due);
}

async function buildSessionDue(now: Date): Promise<Exercise[]> {
  const s = loadSettings();
  const due: Exercise[] = [];
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);

  // Un seul chargement de chaque store (réutilisé par les passes dues / écoute / nouveaux).
  const [vocabAll, grammarAll, comprehensionAll] = await Promise.all([
    allVocab(), allGrammar(), allComprehension(),
  ]);
  const verbPool = drillVerbPool(vocabAll);

  // Collecte items dus (avec carte FSRS)
  for (const v of vocabAll) {
    if (!isTrainableVocab(v)) continue;
    const c = v.cards.written;
    if (c && isDue(c, horizon)) due.push(vocabTypeExercise(v, c.due.getTime()));
  }
  for (const g of grammarAll) {
    if (g.card && isDue(g.card, horizon)) {
      due.push(await grammarSessionExercise(g, g.card.due.getTime(), verbPool));
    }
  }
  for (const c of comprehensionAll) {
    if (c.card && isDue(c.card, horizon)) {
      due.push(comprehensionReviewExercise(c, c.card.due.getTime()));
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
      // Amorçage = on est en session (plausiblement en ligne) : pré-chauffe le cache TTS
      // de la phrase pour que les prochaines écoutes marchent aussi hors-ligne.
      if (typeof window !== "undefined") synthesizeText(example.ja, "ja").catch(() => {});
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

  // Budget nouveaux items
  const dateStr = localDateString(now);
  const daily = await getSrsDaily(dateStr);
  const budget = Math.max(0, s.newPerDay - (daily?.introduced ?? 0));

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
      await putVocab(v);
      await bumpSrsDaily(dateStr, { introduced: 1 });
      newCards.push(vocabTypeExercise(v, card.due.getTime()));
    }

    // Grammaire sans carte — même priorisation.
    if (newCards.length < toPromote) {
      for (const g of prioritizeNewGrammar(grammarAll, started)) {
        if (newCards.length >= toPromote) break;
        const card = newCard(now);
        g.card = card;
        await putGrammar(g);
        await bumpSrsDaily(dateStr, { introduced: 1 });
        newCards.push(await grammarSessionExercise(g, card.due.getTime(), verbPool));
      }
    }

    out.push(...newCards);
  }

  return out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
}

async function buildSessionAll(lessonId: string, now: Date): Promise<Exercise[]> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return [];

  const out: Exercise[] = [];
  const { vocab: vocabIds, grammar: grammarIds } = entry.introduces;
  const lessonVerbs: DrillVerb[] = [];

  // Vocab
  for (const id of vocabIds) {
    const v = await getVocab(id);
    if (!v) continue;
    lessonVerbs.push({ surface: v.surface, reading: v.reading, meaning: v.meaning });
    if (!isTrainableVocab(v)) continue;
    if (!v.cards.written) {
      v.cards.written = newCard(now);
      await putVocab(v);
    }
    out.push(vocabTypeExercise(v, v.cards.written!.due.getTime()));
  }

  // Grammaire — drill de conjugaison si possible, sur les verbes de la leçon d'abord.
  const verbPool = lessonVerbs.length ? lessonVerbs : drillVerbPool(await allVocab());
  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (!g) continue;
    if (!g.card) {
      g.card = newCard(now);
      await putGrammar(g);
    }
    out.push(await grammarSessionExercise(g, g.card!.due.getTime(), verbPool));
  }

  // Urgents d'abord, nouveaux à la fin ; bilan plafonné pour rester digeste.
  return out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, SRS.sessionAllCap);
}

/** Note un exercice d'échauffement et replanifie via FSRS. */
export async function gradeCard(ex: Exercise, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  await gradeExercise(ex, grade, now);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
