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
  putGrammar,
  putVocab,
} from "./db";
import { conjugationExercise, type DrillVerb } from "./conjugation";
import type { GrammarItem, VocabItem } from "./db";
import { gradeExercise, type Exercise } from "./exercise";
import { comprehensionReviewExercise, grammarReviewExercise } from "./exerciseBuild";
import { normalizeReading } from "./kana";
import { getCurriculum, getCurriculumEntry, type CurriculumEntry } from "./lessons";
import { isDue, newCard, State, type SrsGrade } from "./srs";
import { SRS } from "./config";
import { loadSettings } from "./settings";

export interface SessionOpts {
  /** "due" = révision SRS globale plafonnée (défaut). "all" = entraînement immédiat toute la leçon. */
  scope?: "due" | "all";
  /** Si fourni et scope="all", filtre sur les ids introduces de cette leçon. */
  lessonId?: string;
}

function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function leechIds(): Promise<Set<string>> {
  const db = await getDB();
  const reviews = await db.getAll("reviews");
  const lapses = new Map<string, number>();
  for (const r of reviews) {
    if (r.grade === "again") lapses.set(r.itemId, (lapses.get(r.itemId) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [id, count] of lapses) {
    if (count >= SRS.leechLapses) ids.add(id);
  }
  return ids;
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
    const c = v.cards.written;
    if (c) { if (isDue(c, horizon)) dueCount++; }
    else newCount++;
    // Compétence écoute : carte dédiée, planifiée indépendamment.
    if (v.cards.oral && isDue(v.cards.oral, horizon)) dueCount++;
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
  const vocabAll = await allVocab();
  const verbPool = drillVerbPool(vocabAll);

  // Collecte items dus (avec carte FSRS)
  for (const v of vocabAll) {
    const c = v.cards.written;
    if (c && isDue(c, horizon)) {
      const hasMeaning = !!v.meaning && v.meaning !== "—";
      due.push({
        mode: "type",
        key: `vocab:${v.id}`,
        track: "vocab",
        id: v.id,
        front: hasMeaning ? v.meaning : v.surface,
        back: `${v.surface}（${v.reading}）`,
        due: c.due.getTime(),
        prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
        answers: hasMeaning
          ? [normalizeReading(v.surface), normalizeReading(v.reading)]
          : [normalizeReading(v.reading)],
        ...(v.example?.ja ? { context: v.example.ja } : {}),
      });
    }
  }
  for (const g of await allGrammar()) {
    if (g.card && isDue(g.card, horizon)) {
      due.push(await grammarSessionExercise(g, g.card.due.getTime(), verbPool));
    }
  }
  for (const c of await allComprehension()) {
    if (c.card && isDue(c.card, horizon)) {
      due.push(comprehensionReviewExercise(c, c.card.due.getTime()));
    }
  }

  // Écoute — compétence dédiée (`cards.oral`), planifiée indépendamment de l'écrit :
  // un mot n'est plus noté deux fois sur la même carte dans une session. Les cartes
  // écoute DUES passent d'abord ; puis on amorce l'écoute de quelques mots déjà
  // stabilisés à l'écrit (état Review) qui ont une phrase d'exemple.
  const LISTEN_MAX = 5;
  const LISTEN_SEEDS = 2;
  const listenExercise = (v: VocabItem, due: number): Exercise => {
    const hasMeaning = !!v.meaning && v.meaning !== "—";
    return {
      mode: "type",
      key: `vocab-listen:${v.id}`,
      track: "vocab",
      skill: "oral",
      id: v.id,
      front: v.example!.ja,
      back: `${v.surface}（${v.reading}）— ${v.meaning}`,
      due,
      audio: { word: v.surface },
      context: v.example!.ja,
      prompt: "Écoute et tape le mot souligné",
      answers: hasMeaning
        ? [normalizeReading(v.surface), normalizeReading(v.reading)]
        : [normalizeReading(v.reading)],
    };
  };
  let listenCount = 0;
  for (const v of vocabAll) {
    if (listenCount >= LISTEN_MAX) break;
    if (v.cards.oral && isDue(v.cards.oral, horizon) && v.example?.ja) {
      due.push(listenExercise(v, v.cards.oral.due.getTime()));
      listenCount++;
    }
  }

  // Plafond de session : items dus triés par urgence, coupés à `sessionCap`. Le reste
  // attendra la session suivante — mieux qu'une session-fleuve après quelques jours
  // d'absence. Les amorces (écoute) et les nouveautés ne prennent que la place restante.
  due.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  const out: Exercise[] = due.slice(0, SRS.sessionCap);
  let room = SRS.sessionCap - out.length;

  let listenSeeds = 0;
  for (const v of vocabAll) {
    if (room <= 0 || listenCount >= LISTEN_MAX || listenSeeds >= LISTEN_SEEDS) break;
    if (!v.cards.oral && v.example?.ja && v.cards.written?.state === State.Review) {
      const card = newCard(now);
      v.cards.oral = card;
      await putVocab(v);
      out.push(listenExercise(v, card.due.getTime()));
      listenCount++;
      listenSeeds++;
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
      const card = newCard(now);
      v.cards.written = card;
      await putVocab(v);
      await bumpSrsDaily(dateStr, { introduced: 1 });
      const hasMeaning = !!v.meaning && v.meaning !== "—";
      newCards.push({
        mode: "type",
        key: `vocab:${v.id}`,
        track: "vocab",
        id: v.id,
        front: hasMeaning ? v.meaning : v.surface,
        back: `${v.surface}（${v.reading}）`,
        due: card.due.getTime(),
        prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
        answers: hasMeaning
          ? [normalizeReading(v.surface), normalizeReading(v.reading)]
          : [normalizeReading(v.reading)],
        ...(v.example?.ja ? { context: v.example.ja } : {}),
      });
    }

    // Grammaire sans carte — même priorisation.
    if (newCards.length < toPromote) {
      for (const g of prioritizeNewGrammar(await allGrammar(), started)) {
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
    if (!v.cards.written) {
      v.cards.written = newCard(now);
      await putVocab(v);
    }
    const c = v.cards.written!;
    const hasMeaning = !!v.meaning && v.meaning !== "—";
    out.push({
      mode: "type",
      key: `vocab:${v.id}`,
      track: "vocab",
      id: v.id,
      front: hasMeaning ? v.meaning : v.surface,
      back: `${v.surface}（${v.reading}）`,
      due: c.due.getTime(),
      prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
      answers: hasMeaning
        ? [normalizeReading(v.surface), normalizeReading(v.reading)]
        : [normalizeReading(v.reading)],
      ...(v.example?.ja ? { context: v.example.ja } : {}),
    });
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

  // Urgents d'abord, nouveaux à la fin
  return out.sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
}

/** Note un exercice d'échauffement et replanifie via FSRS. */
export async function gradeCard(ex: Exercise, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  await gradeExercise(ex, grade, now);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
