// Séances d'exercices (SPEC §5) : les étapes du parcours (Vocabulaire, Grammaire, Révision,
// Produire), l'entraînement libre sur une leçon et les exercices d'une histoire. Tous les
// exercices exigent un input (QCM, saisie, ou construction) ; voir lib/exercise.ts.


import {
  allComprehension,
  allGrammar,
  allLessonProgress,
  allVocab,
  bumpSrsDaily,
  deleteComprehensionItem,
  getGrammar,
  getVocab,
  localDateString,
  putGrammar,
  putVocab,
} from "./db";
import type { GrammarItem, VocabItem } from "./db";
import { grammarCorrectionExercise, grammarUsageExercise, type GrammarSentence } from "./exam";
import { gradeExercise, type Exercise } from "./exercise";
import {
  buildDrill,
  grammarBuildExercise,
  grammarChoiceExercise,
  grammarDictationExercise,
  grammarReviewExercise,
  vocabDictationExercise,
  vocabListenMeaningExercise,
  vocabTriangleExercise,
  vocabTypeExercise,
} from "./exerciseBuild";
import { getCurriculum, getCurriculumEntry } from "./curriculum";
import { enrollLesson } from "./enroll";
import { grammarDetail, grammarExamples, grammarForm, staticExample } from "./inventory";
import { isPreAcquiredGrammar, isPreAcquiredVocab, REVIEW_STEP_SIZE, type PathLevel } from "./path";
import { isAcquired, isDue, newCard, retrievability, State, type Card, type SrsGrade } from "./srs";
import { tokenize } from "./tokenizer";
import { SRS } from "./config";
import { shuffle } from "./random";
import { isSilentMode, loadSettings } from "./settings";
import { loadLeechIds } from "./leech";
import { effectiveExample, mergeSkillCards, purgeIncidentalCards, purgeNameVocab, repairConjugatedVocab } from "./vocab";
import { isTrainableVocab } from "./vocabFaces";
import { KIND_LEVEL, orderDrills, type DrillKind } from "./vocabDrills";

/** Étapes du parcours qui sont des séances d'exercices sur les éléments d'une leçon. */
export type LessonStepScope = "vocab" | "grammar" | "produce";

export interface SessionOpts {
  /** "due" = étape Révision du parcours (défaut). "step" = séance d'une étape de leçon
   *  (Vocabulaire, Grammaire, Produire). "rest" = station de repos (révision longue des
   *  dernières leçons). "all" = entraînement libre sur toute la leçon. "story" = les mots
   *  d'un texte lu, hors planification. */
  scope?: "due" | "all" | "story" | "step" | "rest";
  /** Leçon visée (scopes "all" et "step") ; scope "due" : la leçon en cours, dont les
   *  leçons N−1 et N−3 fournissent les rappels de l'étape Révision. */
  lessonId?: string;
  /** scope "rest" : les leçons que la station de repos révise. */
  lessonIds?: string[];
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
  } else if (scope === "rest") {
    exercises = await buildSessionRest(opts.lessonIds ?? [], now, leeches);
  } else {
    exercises = await buildSessionReview(now, leeches, { itemIds: opts.itemIds, lessonId: opts.lessonId });
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
 *    (lib/vocabDrills.ts), bornée par le niveau que le mot a atteint dans le parcours ;
 *    la première constructible gagne ;
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
    async drill(v: VocabItem, due: number, maxLevel?: PathLevel): Promise<Exercise> {
      const isLeech = leeches.has(v.id);
      const hasExample = !!effectiveExample(v)?.ja;
      for (const kind of orderDrills(v, { silent: ctx.silent, hasExample, maxLevel })) {
        const ex = await buildDrill(v, kind, due, { pool, isLeech });
        if (ex) return remember(tagDrill(ex, kind), v);
      }
      // Filet : `orderDrills` porte toujours l'écrit, toujours constructible.
      return remember(tagDrill(vocabTriangleExercise(v, due, pool, { isLeech }), "written"), v);
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

/** Forme et niveau d'un exercice de révision tiré parmi les formes du répertoire. */
function tagDrill(ex: Exercise, kind: DrillKind): Exercise {
  // L'écrit en saisie est du RAPPEL (niveau 2) ; en QCM, de la reconnaissance (niveau 1).
  if (kind === "written") {
    return ex.mode === "type" ? { ...ex, form: "written-type", level: 2 } : { ...ex, form: "written-choice", level: 1 };
  }
  return { ...ex, form: kind, level: KIND_LEVEL[kind] };
}

/** Clé d'exercice propre à un niveau (le même élément passe plusieurs fois dans une étape),
 *  avec sa forme et son niveau pour la note et le journal. */
function atLevel(ex: Exercise, level: PathLevel, form: string): Exercise {
  return { ...ex, key: `${ex.key}#n${level}`, level, form };
}

/**
 * Un exercice de vocabulaire À UN NIVEAU du parcours (SPEC §5.3) :
 *  1 · reconnaître — le triangle en QCM ;
 *  2 · rappeler — la saisie de la lecture, ou le sens à l'écoute ;
 *  3 · produire — la production en contexte, ou la dictée de sa phrase.
 * Effet de bord du triangle (`lastDir`) : l'appelant persiste le mot.
 */
async function vocabAtLevel(
  v: VocabItem,
  level: PathLevel,
  due: number,
  ctx: { pool: VocabItem[]; silent: boolean; isLeech: boolean },
): Promise<Exercise> {
  const hasExample = !!effectiveExample(v)?.ja;
  if (level === 1) {
    return atLevel(vocabTriangleExercise(v, due, ctx.pool, { isLeech: ctx.isLeech, mode: "choice" }), 1, "written-choice");
  }
  if (level === 2) {
    const listen = !ctx.silent && hasExample && Math.random() < 0.5 ? vocabListenMeaningExercise(v, due, ctx.pool) : null;
    return listen
      ? atLevel(listen, 2, "listen-meaning")
      : atLevel(vocabTriangleExercise(v, due, ctx.pool, { isLeech: ctx.isLeech, mode: "type" }), 2, "written-type");
  }
  const dictation =
    !ctx.silent && hasExample && Math.random() < 1 / 3 ? await vocabDictationExercise(v, due).catch(() => null) : null;
  return dictation
    ? atLevel(dictation, 3, "dictation")
    : atLevel(await vocabTypeExercise(v, due, { produce: true, pool: ctx.pool }), 3, "production");
}

/**
 * La matière d'un point de grammaire (SPEC §5.3), en deux réserves :
 *  - `own` : les phrases PROPRES au point, dans son sens précis — son exemple du
 *    référentiel, puis les phrases générées pour lui (`grammarExamples`). Elles portent la
 *    phrase à reconstruire, la dictée et la correction.
 *  - `form` : des phrases où figure seulement sa FORME — exemples des mots des dernières
 *    leçons (lexique déjà vu). に y marque peut-être un moment quand le point enseigne le
 *    lieu : elles ne servent qu'à l'emploi et à la correction, qui travaillent la forme.
 */
interface PointMaterial {
  own: GrammarSentence[];
  form: GrammarSentence[];
}

const NO_MATERIAL: PointMaterial = { own: [], form: [] };

/** Leçons dont les exemples de mots alimentent la réserve `form` : la leçon et les 5 d'avant. */
const FORM_LESSONS_BACK = 5;

/** Tokenise une phrase pour la matière d'un point ; tokeniseur indisponible → écartée. */
async function sentenceOf(s: { ja: string; fr?: string }): Promise<GrammarSentence | null> {
  const tokens = await tokenize(s.ja).catch(() => null);
  return tokens?.length ? { ja: s.ja, ...(s.fr ? { fr: s.fr } : {}), tokens } : null;
}

/**
 * La FORME du point figure-t-elle dans la phrase ? Une particule ou un auxiliaire court se
 * cherche comme MOT (token 助詞/助動詞 de même surface) — は figure dans はい sans y être
 * une particule ; une forme plus longue (ている, ませんでした) se cherche dans le texte.
 */
function showsForm(form: string, s: GrammarSentence): boolean {
  if (form.length >= 3) return s.ja.includes(form);
  return s.tokens.some((t) => t.surface_form === form && (t.pos === "助詞" || t.pos === "助動詞"));
}

async function pointMaterial(g: GrammarItem, lessonId: string): Promise<PointMaterial> {
  // Une phrase n'entre qu'une fois, dans la première réserve qui la propose.
  const seen = new Set<string>();
  const fresh = (s: { ja: string; fr?: string } | null | undefined): s is { ja: string; fr?: string } => {
    if (!s?.ja || seen.has(s.ja)) return false;
    seen.add(s.ja);
    return true;
  };

  const detail = grammarDetail(g.id);
  const ownRaw = [
    ...(detail?.exampleJa ? [{ ja: detail.exampleJa, fr: detail.exampleFr }] : []),
    ...grammarExamples(g.id),
  ].filter(fresh);
  const own = (await Promise.all(ownRaw.map(sentenceOf))).filter((s): s is GrammarSentence => !!s);

  // Seule une forme en kana se reconnaît dans une phrase (« adjectif -い » ne se cherche pas).
  const form = grammarForm(detail?.name ?? g.name);
  if (!/^[ぁ-ゖ]+$/.test(form)) return { own, form: [] };
  const curriculum = getCurriculum();
  const i = curriculum.findIndex((e) => e.id === lessonId);
  const ids = curriculum.slice(Math.max(0, i - FORM_LESSONS_BACK), i + 1).flatMap((e) => e.introduces.vocab);
  const formRaw = ids.map((id) => staticExample(id)).filter(fresh);
  const formSentences = (await Promise.all(formRaw.map(sentenceOf))).filter(
    (s): s is GrammarSentence => !!s && showsForm(form, s),
  );
  return { own, form: formSentences };
}

/** Une phrase au hasard d'une réserve, ou undefined si elle est vide. */
function pick<T>(list: T[]): T | undefined {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

/**
 * Les exercices de grammaire d'un point À UN NIVEAU (SPEC §5.3), deux par niveau :
 *  1 · reconnaître — le rôle du point en QCM, et son EMPLOI (la particule à remettre) ;
 *  2 · rappeler — une phrase du point à reconstruire, et la CORRECTION (la seule juste) ;
 *  3 · produire — la dictée d'une phrase du point, ou sa reconstruction sans le son.
 * Les phrases sont tirées dans la matière du point (`pointMaterial`) : d'une étape à
 * l'autre, ce n'est pas toujours la même. Un exercice impossible faute de matière cède sa
 * place au premier du niveau, jamais à un exercice d'un autre niveau.
 */
async function grammarAtLevel(
  g: GrammarItem,
  level: PathLevel,
  due: number,
  ctx: { material: PointMaterial; silent: boolean },
): Promise<Exercise[]> {
  const { own, form } = ctx.material;
  if (level === 1) {
    const rule = atLevel(grammarChoiceExercise(g, due), 1, "grammar-rule");
    const usage = grammarUsageExercise(g, shuffle([...own, ...form]));
    return [rule, usage ? atLevel({ ...usage, due }, 1, "grammar-usage") : atLevel(grammarChoiceExercise(g, due), 1, "grammar-rule")]
      .map((ex, i) => ({ ...ex, key: `${ex.key}.${i}` }));
  }
  if (level === 2) {
    const build = await grammarBuildExercise(g, due, pick(own));
    const correction = [pick(own), pick(form)].reduce<Exercise | null>(
      (found, s) => found ?? (s ? grammarCorrectionExercise(g, s) : null),
      null,
    );
    const out = [
      build ? atLevel(build, 2, "grammar-build") : atLevel(grammarChoiceExercise(g, due), 2, "grammar-rule"),
      ...(correction ? [atLevel({ ...correction, due }, 2, "grammar-correction")] : []),
    ];
    return out.map((ex, i) => ({ ...ex, key: `${ex.key}.${i}` }));
  }
  const dictation = ctx.silent ? null : await grammarDictationExercise(g, due, pick(own));
  if (dictation) return [atLevel(dictation, 3, "grammar-dictation")];
  const build = await grammarBuildExercise(g, due, pick(own));
  return [build ? atLevel(build, 3, "grammar-build") : atLevel(grammarChoiceExercise(g, due), 3, "grammar-rule")];
}

/**
 * Niveau maximal que la révision peut servir pour chaque élément : 3 une fois sa leçon
 * terminée (tous les niveaux sont ouverts, SPEC §2.2) ; sinon le niveau atteint dans le
 * parcours, à défaut 2 s'il était déjà acquis ailleurs, 1 sinon. Un élément hors de toute
 * leçon (ajouté depuis le Lecteur) n'a pas de borne.
 */
async function levelCaps(): Promise<(item: VocabItem | GrammarItem) => PathLevel | undefined> {
  const done = new Set((await allLessonProgress()).filter((p) => p.completedAt).map((p) => p.id));
  const finished = new Set<string>();
  const taught = new Set<string>();
  for (const e of getCurriculum()) {
    for (const id of [...e.introduces.vocab, ...e.introduces.grammar]) {
      taught.add(id);
      if (done.has(e.id)) finished.add(id);
    }
  }
  return (item) => {
    if (!taught.has(item.id)) return undefined;
    if (finished.has(item.id)) return 3;
    if (item.level) return item.level;
    return item.status === "known" || isAcquired(item.card) ? 2 : 1;
  };
}

/** Rappels portés par le parcours (SPEC §5.4) : 2 éléments de N−1 au niveau 2, 1 de N−3 au niveau 3. */
const RECALLS: { back: number; level: PathLevel; count: number }[] = [
  { back: 1, level: 2, count: 2 },
  { back: 3, level: 3, count: 1 },
];

/**
 * L'étape Révision du parcours (SPEC §5.4) : `REVIEW_STEP_SIZE` cartes.
 *  ① les RAPPELS réservés : des éléments des leçons N−1 et N−3 (les plus fragiles d'abord),
 *     à un niveau fixé — les mots reviennent au rythme où l'on avance ;
 *  ② les cartes DUES, toutes leçons confondues, les plus urgentes d'abord ;
 *  ③ faute de dû, les éléments les plus FRAGILES (plus faible probabilité de rappel FSRS,
 *     les difficiles d'abord) : une étape Révision n'est jamais vide tant qu'il existe des
 *     cartes, ce qui garde la séance sans fin. FSRS traite une révision anticipée — elle
 *     compte, et fait moins progresser la stabilité qu'une révision à l'échéance.
 * La forme d'un élément dû ou fragile ne dépasse jamais le niveau atteint dans sa leçon.
 *
 * `itemIds` cible la révision sur des éléments donnés (les ratés d'un contrôle) : ils sont
 * servis qu'ils soient dus ou non, sans rappel ni complément.
 */
async function buildSessionReview(
  now: Date,
  leeches: Set<string>,
  opts: { itemIds?: string[]; lessonId?: string } = {},
): Promise<Exercise[]> {
  // Sans le son : réglage permanent OU pause « je ne peux pas écouter » encore en cours.
  // Le tirage de forme écarte alors l'écoute — inutile de la construire pour la remplacer.
  const silent = isSilentMode(loadSettings(), now);
  const horizon = new Date(now.getTime() + 15 * 60 * 1000);

  // Un seul chargement de chaque store.
  const [vocabAll, grammarAll, capOf] = await Promise.all([allVocab(), allGrammar(), levelCaps()]);
  // Le pool de distracteurs, c'est tout le vocabulaire connu : un QCM tire ses options
  // sur la même face que la réponse (cf. faceDistractors).
  const make = exerciseFactory(vocabAll, leeches, { silent });

  // Candidats : un mot = UNE carte = UN exercice. La forme (écrit, écoute, dictée,
  // production) est tirée mot par mot — c'est ce qui donne la variété.
  type Candidate = {
    card: Card;
    id: string;
    build: () => Promise<Exercise>;
    atLevel: (level: PathLevel) => Promise<Exercise>;
  };
  const candidates: Candidate[] = [];
  for (const v of vocabAll) {
    if (!isTrainableVocab(v) || !v.card) continue;
    const card = v.card;
    candidates.push({
      card,
      id: v.id,
      build: () => make.drill(v, card.due.getTime(), capOf(v)),
      atLevel: async (level) => {
        const ex = await vocabAtLevel(v, level, card.due.getTime(), { pool: vocabAll, silent, isLeech: leeches.has(v.id) });
        await putVocab(v);
        return ex;
      },
    });
  }
  for (const g of grammarAll) {
    if (!g.card) continue;
    const card = g.card;
    candidates.push({
      card,
      id: g.id,
      build: async () => ({ ...(await grammarReviewExercise(g, card.due.getTime())), form: "grammar-review" }),
      atLevel: async (level) => (await grammarAtLevel(g, level, card.due.getTime(), { material: NO_MATERIAL, silent }))[0],
    });
  }
  const byWeakness = (list: Candidate[]) =>
    list
      .filter((c) => c.card.state !== State.New)
      .map((c) => ({ c, r: retrievability(c.card, now), leech: leeches.has(c.id) }))
      .sort((a, b) => Number(b.leech) - Number(a.leech) || a.r - b.r)
      .map((x) => x.c);

  const out: Exercise[] = [];
  if (opts.itemIds) {
    const wanted = new Set(opts.itemIds);
    for (const c of candidates.filter((x) => wanted.has(x.id))) out.push(await c.build());
  } else {
    const used = new Set<string>();
    // ① Rappels des leçons N−1 et N−3.
    const curriculum = getCurriculum();
    const i = opts.lessonId ? curriculum.findIndex((e) => e.id === opts.lessonId) : -1;
    if (i >= 0) {
      for (const r of RECALLS) {
        const entry = curriculum[i - r.back];
        if (!entry) continue;
        const ids = new Set([...entry.introduces.vocab, ...entry.introduces.grammar]);
        for (const c of byWeakness(candidates.filter((x) => ids.has(x.id))).slice(0, r.count)) {
          used.add(c.id);
          out.push({ ...(await c.atLevel(r.level)), key: `recall:${c.id}` });
        }
      }
    }
    // ② Dus, les plus urgents d'abord ; ③ puis les plus fragiles parmi ceux déjà travaillés
    // (une carte neuve n'a pas de mémoire à entretenir).
    const rest = candidates.filter((c) => !used.has(c.id));
    const due = rest
      .filter((c) => isDue(c.card, horizon))
      .sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
    const fragile = byWeakness(rest.filter((c) => !isDue(c.card, horizon)));
    for (const c of [...due, ...fragile].slice(0, Math.max(0, REVIEW_STEP_SIZE - out.length))) {
      out.push(await c.build());
    }
  }

  // Le tri sert à CHOISIR les cartes de l'étape, pas à dicter l'ordre de passage : sans
  // mélange, les mêmes mots reviendraient dans la même séquence, étape après étape.
  const deck = shuffle(out);
  await make.flush(deck);
  return deck;
}

/** Exercices d'une station de repos (SPEC §5.4). */
export const REST_STEP_SIZE = 20;

/**
 * La station de repos, toutes les 5 leçons : une révision longue des éléments des leçons
 * données, les plus fragiles d'abord, aux niveaux 2 et 3 en alternance. Les cartes neuves
 * (jamais révisées) n'y sont pas : il n'y a rien à entretenir.
 */
async function buildSessionRest(lessonIds: string[], now: Date, leeches: Set<string>): Promise<Exercise[]> {
  const silent = isSilentMode(loadSettings(), now);
  const ids = new Set(
    lessonIds.flatMap((id) => {
      const e = getCurriculumEntry(id);
      return e ? [...e.introduces.vocab, ...e.introduces.grammar] : [];
    }),
  );
  const [vocabAll, grammarAll] = await Promise.all([allVocab(), allGrammar()]);
  type Item = { id: string; card: Card; v?: VocabItem; g?: GrammarItem };
  const items: Item[] = [
    ...vocabAll.filter((v) => ids.has(v.id) && v.card && isTrainableVocab(v)).map((v) => ({ id: v.id, card: v.card!, v })),
    ...grammarAll.filter((g) => ids.has(g.id) && g.card).map((g) => ({ id: g.id, card: g.card!, g })),
  ]
    .filter((x) => x.card.state !== State.New)
    .map((x) => ({ x, r: retrievability(x.card, now), leech: leeches.has(x.id) }))
    .sort((a, b) => Number(b.leech) - Number(a.leech) || a.r - b.r)
    .map((s) => s.x)
    .slice(0, REST_STEP_SIZE);

  const out: Exercise[] = [];
  for (const [k, item] of items.entries()) {
    const level: PathLevel = k % 2 === 0 ? 2 : 3;
    const due = item.card.due.getTime();
    if (item.v) {
      out.push(await vocabAtLevel(item.v, level, due, { pool: vocabAll, silent, isLeech: leeches.has(item.id) }));
      await putVocab(item.v);
    } else if (item.g) {
      out.push((await grammarAtLevel(item.g, level, due, { material: NO_MATERIAL, silent }))[0]);
    }
  }
  return shuffle(out);
}

/** Donne sa carte FSRS à un élément qui n'en a pas encore : sa PREMIÈRE rencontre en exercice. */
async function ensureCard<T extends { card?: Card }>(item: T, now: Date): Promise<Card> {
  if (item.card) return item.card;
  item.card = newCard(now);
  await bumpSrsDaily(localDateString(now), { introduced: 1 });
  return item.card;
}

/**
 * Séance d'une étape de leçon (SPEC §5.2, §5.3). Chaque élément nouveau est réussi trois
 * fois dans sa leçon, à trois niveaux de difficulté croissante : les deux premiers dans
 * l'étape Vocabulaire (ou Grammaire), le troisième à l'étape Produire. Dans une étape,
 * TOUS les exercices du premier niveau passent avant ceux du second : chaque élément est
 * revu après quelques autres, jamais deux fois de suite.
 *
 *  - Vocabulaire : niveaux 1 et 2, un exercice chacun — pour les mots pas encore acquis.
 *  - Grammaire : niveaux 1 et 2, deux exercices chacun — pour les points pas encore acquis.
 *  - Produire : niveau 3 pour TOUS les éléments de la leçon (un par mot, deux par point :
 *    la dictée de sa phrase et la phrase à reconstruire).
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
  const words = entry.introduces.vocab.map((id) => byId.get(id)).filter((v): v is VocabItem => !!v);
  const first: Exercise[] = [];
  const second: Exercise[] = [];

  if (step === "vocab" || step === "produce") {
    for (const v of words) {
      if (!isTrainableVocab(v)) continue;
      if (step === "vocab" && isPreAcquiredVocab(v)) continue;
      const due = (await ensureCard(v, now)).due.getTime();
      const ctx = { pool, silent, isLeech: leeches.has(v.id) };
      if (step === "vocab") {
        first.push(await vocabAtLevel(v, 1, due, ctx));
        second.push(await vocabAtLevel(v, 2, due, ctx));
      } else {
        first.push(await vocabAtLevel(v, 3, due, ctx));
      }
      await putVocab(v);
    }
  }

  if (step === "grammar" || step === "produce") {
    for (const id of entry.introduces.grammar) {
      const g = await getGrammar(id);
      if (!g) continue;
      if (step === "grammar" && isPreAcquiredGrammar(g)) continue;
      const due = (await ensureCard(g, now)).due.getTime();
      await putGrammar(g);
      const ctx = { material: await pointMaterial(g, lessonId), silent };
      if (step === "grammar") {
        first.push(...(await grammarAtLevel(g, 1, due, ctx)));
        second.push(...(await grammarAtLevel(g, 2, due, ctx)));
      } else {
        first.push(...(await grammarAtLevel(g, 3, due, ctx)));
        // Deuxième production du point : une de ses phrases à reconstruire (si la dictée
        // a été servie), à défaut un second tour de la même forme.
        const build = await grammarBuildExercise(g, due, pick(ctx.material.own));
        if (build && !first.some((ex) => ex.key.startsWith(`grammar:${g.id}#`))) {
          first.push(atLevel(build, 3, "grammar-build"));
        }
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
export async function gradeCard(
  ex: Exercise,
  grade: SrsGrade,
  now: Date = new Date(),
  opts: { ms?: number } = {},
): Promise<void> {
  await gradeExercise(ex, grade, now, opts);
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}
