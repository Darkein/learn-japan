// Flux d'étude : le PARCOURS (SPEC §5). L'app enchaîne les étapes de la leçon en cours —
// cours, vocabulaire, grammaire, révision, histoire, produire, contrôle — puis celles de la
// leçon suivante, avec un point de sortie à chaque checkpoint. La séance n'a pas de fin
// imposée : il y a toujours une étape suivante, on s'arrête quand on veut. L'omikuji du jour
// n'en fait PAS partie : la bandelette s'ouvre d'elle-même au lancement de l'app (voir
// lib/omikuji.ts, ui/Home.tsx).
//
// RÈGLE DURE : `pickNext` est PURE et DÉTERMINISTE — aucun Math.random, aucun accès IO.
// Même FlowState → même activité, entre l'accueil et le checkpoint, et dans les tests.
// Tout l'IO vit dans `gatherFlowState` (collecteur mince, non testé unitairement).

import {
  allStories,
  getMeta,
  getSrsDaily,
  localDateString,
  type StoryRecord,
} from "./db";
import { examStatus } from "./exam";
import { listLessons, type Lesson } from "./lessons";
import { currentMirrorCandidate } from "./mirror";
import {
  CONTENT_STEPS,
  REVIEW_INSERT_THRESHOLD,
  REVIEW_STEP_SIZE,
  STEP_LABEL,
  nextStep,
  stepNumber,
  type PathStep,
} from "./path";
import { sessionStats } from "./reviewSession";
import { loadSettings } from "./settings";

export type FlowActivityKind =
  | "lesson" // étape Cours : le cours de la leçon (il ouvre une leçon pas encore commencée)
  | "vocab" // étape Vocabulaire
  | "grammar" // étape Grammaire
  | "review" // étape Révision, révision insérée devant le neuf, ou révision ciblée (rattrapage)
  | "read-story" // étape Histoire
  | "produce" // étape Produire
  | "exam" // contrôle de la leçon (le 関所) : il ouvre la suivante
  | "rest" // station de repos, toutes les 5 leçons : révision longue des 5 dernières
  | "mirror" // relecture-miroir (une vieille histoire, pour mesurer le chemin)
  | "done"; // rien à proposer : aucune leçon ouverte et aucune carte (cas limite)

export interface FlowActivity {
  kind: FlowActivityKind;
  /** Cible concrète : storyId (read-story/mirror) ou lessonId (lesson, étapes, exam). */
  refId?: string;
  /** Leçon de l'étape, quand l'activité en fait partie. */
  lessonId?: string;
  /** L'étape que l'activité VALIDE une fois finie ; absente pour une révision insérée,
   *  une révision ciblée ou un miroir, qui ne font pas avancer le parcours. */
  step?: PathStep;
  /** Révision ciblée : les éléments à repasser (les ratés d'un contrôle). */
  itemIds?: string[];
  /** Station de repos : les leçons qu'elle révise. */
  lessonIds?: string[];
  /** Libellé du bouton « Continuer avec : … ». */
  title: string;
  /** Justification courte affichée au checkpoint. */
  reason: string;
}

export interface FlowState {
  dueCount: number;
  /** Au moins une carte existe : une étape Révision a toujours de quoi servir. */
  hasCards: boolean;
  /** Étapes du parcours validées aujourd'hui, et l'objectif du jour en étapes (§5.1). */
  stepsToday: number;
  dailySteps: number;
  flowMsToday: number;
  currentLesson?: {
    id: string;
    title: string;
    /** Étapes du parcours de la leçon, dans l'ordre (SPEC §5.2). */
    steps: PathStep[];
    /** Étapes déjà faites. */
    stepsDone: PathStep[];
    /** Première histoire de la leçon jamais ouverte (meta storyRead absent). */
    unreadStoryId?: string;
    unreadStoryTitle?: string;
    /** Une histoire de la leçon à lire si toutes l'ont déjà été (relecture). */
    anyStoryId?: string;
    /** Ratés du dernier contrôle échoué pas encore repassés : la révision ciblée d'abord. */
    retakePending?: string[];
  };
  nextLesson?: { id: string; title: string; ready: boolean };
  /** Station de repos due (SPEC §5.4) : après le contrôle d'une 5e leçon, avant le cours
   *  de la suivante. `key` = la leçon qui la déclenche. */
  restDue?: { key: string; lessonIds: string[] };
  mirrorCandidate?: { storyId: string; title: string; ageDays: number };
  lastActivity?: FlowActivityKind;
  /** Une relecture-miroir a déjà été proposée dans cette séance (au plus une). */
  mirrorDoneThisFlow?: boolean;
}

const STEP_KIND: Record<PathStep, FlowActivityKind> = {
  course: "lesson",
  vocab: "vocab",
  grammar: "grammar",
  review: "review",
  story: "read-story",
  produce: "produce",
  exam: "exam",
};

const STEP_REASON: Record<PathStep, string> = {
  course: "Le cours de la leçon : ses mots et ses règles, posés avant les exercices.",
  vocab: "Les mots de la leçon : les reconnaître, puis les retrouver.",
  grammar: "Les règles de la leçon : leur rôle, puis leur place dans une phrase.",
  review: "Un tour de révision : ce qui est dû, sinon ce qui s'efface le plus vite.",
  story: "Une histoire de la leçon — ses mots en contexte.",
  produce: "Le dernier niveau : écrire les mots et les phrases de la leçon toi-même.",
  exam: "Le poste de contrôle : franchis la barrière pour ouvrir la leçon suivante.",
};

/**
 * Choisit LA prochaine activité du parcours. Dans l'ordre :
 * ① relecture-miroir, au plus une fois par séance, entre deux étapes ;
 * ② après un contrôle échoué, la révision CIBLÉE de ses ratés, puis le rattrapage ;
 * ③ une révision INSÉRÉE devant une étape de contenu nouveau quand le retard dépasse deux
 *    étapes Révision — au plus une par étape : le neuf ralentit, il ne gèle jamais ;
 * ④ l'étape suivante de la leçon en cours ;
 * ⑤ entre deux leçons, la station de repos quand elle est due (toutes les 5 leçons) ;
 * ⑥ le cours de la prochaine leçon débloquée (il la commence) ;
 * ⑦ une étape Révision libre, tant qu'il existe des cartes (fin du curriculum, leçon
 *    suivante verrouillée) — la séance reste sans fin ;
 * ⑧ done, seulement quand il n'y a vraiment rien (profil vierge sans leçon ouverte).
 */
export function pickNext(state: FlowState): FlowActivity {
  const s = state;
  const cur = s.currentLesson;

  if (s.mirrorCandidate && !s.mirrorDoneThisFlow && s.lastActivity && s.lastActivity !== "mirror") {
    return {
      kind: "mirror",
      refId: s.mirrorCandidate.storyId,
      title: `Relecture-miroir — ${s.mirrorCandidate.title}`,
      reason: `Tu l'as lue il y a ${s.mirrorCandidate.ageDays} jours — mesure le chemin parcouru.`,
    };
  }

  if (cur) {
    const step = nextStep(cur.steps, new Set(cur.stepsDone));
    if (step === "exam" && cur.retakePending?.length && s.lastActivity !== "review") {
      const n = cur.retakePending.length;
      return {
        kind: "review",
        lessonId: cur.id,
        itemIds: cur.retakePending,
        title: `Révision ciblée — ${n} élément${n > 1 ? "s" : ""} raté${n > 1 ? "s" : ""}`,
        reason: "Avant le rattrapage, on repasse ce que le contrôle a fait tomber.",
      };
    }
    if (step) {
      if (CONTENT_STEPS.has(step) && s.dueCount > REVIEW_INSERT_THRESHOLD && s.lastActivity !== "review") {
        return {
          kind: "review",
          lessonId: cur.id,
          title: `Révision · ${s.dueCount} cartes en attente`,
          reason: "Le retard monte : un tour de révision avant la suite de la leçon.",
        };
      }
      return stepActivity(cur, step);
    }
  }

  if (!cur && s.restDue) {
    return {
      kind: "rest",
      lessonIds: s.restDue.lessonIds,
      title: `Station de repos — les ${s.restDue.lessonIds.length} dernières leçons`,
      reason: "Une pause sur la route : on consolide ce que les dernières leçons ont appris.",
    };
  }

  if (s.nextLesson) {
    return {
      kind: "lesson",
      refId: s.nextLesson.id,
      lessonId: s.nextLesson.id,
      step: "course",
      title: `Nouvelle leçon — ${s.nextLesson.title}`,
      reason: "La leçon suivante est ouverte : son cours d'abord.",
    };
  }

  if (s.hasCards) {
    return {
      kind: "review",
      title: `Révision (${REVIEW_STEP_SIZE} cartes)`,
      reason:
        s.dueCount > 0
          ? "Les cartes dues d'abord, puis ce qui s'efface le plus vite."
          : "Rien n'est dû : on entretient ce qui s'efface le plus vite.",
    };
  }

  return {
    kind: "done",
    title: "Arrêter ici",
    reason: "Rien à proposer pour l'instant : ouvre une leçon pour commencer le parcours.",
  };
}

/** L'activité d'une étape de la leçon en cours, avec son rang dans le parcours. */
function stepActivity(cur: NonNullable<FlowState["currentLesson"]>, step: PathStep): FlowActivity {
  const n = stepNumber(cur.steps, step);
  const storyId = step === "story" ? (cur.unreadStoryId ?? cur.anyStoryId) : undefined;
  return {
    kind: STEP_KIND[step],
    refId: storyId ?? cur.id,
    lessonId: cur.id,
    step,
    title: `Étape ${n}/${cur.steps.length} · ${STEP_LABEL[step]} — ${cur.title}`,
    reason: STEP_REASON[step],
  };
}

// ---- Prévisualisation (carte d'accueil) ------------------------------------------

export interface FlowPreviewStep {
  kind: FlowActivityKind;
  /** Libellé court en français, prêt à joindre : « le vocabulaire, puis la grammaire ». */
  label: string;
}

const PREVIEW_LABEL: Record<PathStep, string> = {
  course: "le cours",
  vocab: "le vocabulaire",
  grammar: "la grammaire",
  review: "une révision",
  story: "une histoire",
  produce: "la production",
  exam: "le contrôle",
};

/**
 * Déroule `pickNext` en simulant l'avancement d'une séance qui démarre : les `n` prochaines
 * étapes annoncées sur la carte d'accueil. Pure — ne mute pas `state`. S'arrête à l'entrée
 * d'une nouvelle leçon : ses étapes ne sont pas connues ici.
 */
export function previewFlow(state: FlowState, n = 3): FlowPreviewStep[] {
  const sim: FlowState = {
    ...state,
    currentLesson: state.currentLesson
      ? { ...state.currentLesson, stepsDone: [...state.currentLesson.stepsDone] }
      : undefined,
    lastActivity: undefined,
    // L'aperçu annonce le parcours, pas le miroir : il a sa propre carte sur l'accueil.
    mirrorDoneThisFlow: true,
  };
  const steps: FlowPreviewStep[] = [];
  while (steps.length < n) {
    const a = pickNext(sim);
    if (a.kind === "done") break;
    if (a.step && sim.currentLesson && a.lessonId === sim.currentLesson.id) {
      steps.push({ kind: a.kind, label: PREVIEW_LABEL[a.step] });
      sim.currentLesson.stepsDone.push(a.step);
      if (a.step === "exam") break; // l'issue du contrôle n'est pas connue d'avance
    } else if (a.kind === "lesson") {
      steps.push({ kind: a.kind, label: "une nouvelle leçon" });
      break;
    } else if (a.kind === "rest") {
      steps.push({ kind: a.kind, label: "une station de repos" });
      sim.restDue = undefined;
    } else {
      steps.push({ kind: a.kind, label: a.itemIds ? "une révision ciblée" : "une révision" });
      sim.dueCount = Math.max(0, sim.dueCount - REVIEW_STEP_SIZE);
      if (a.itemIds && sim.currentLesson) sim.currentLesson.retakePending = undefined;
      if (!sim.currentLesson && !sim.nextLesson) break; // révision libre : elle se répète
    }
    sim.lastActivity = a.kind;
  }
  return steps;
}

// ---- Collecteur IO -------------------------------------------------------------

export interface FlowGathered {
  state: FlowState;
  /** Leçons déjà chargées — réutilisables par l'appelant (Tōkaidō) sans repayer listLessons. */
  lessons: Lesson[];
}

/**
 * État de lecture des histoires d'une leçon (meta `storyRead.<id>`) : la première jamais
 * ouverte (à proposer), à défaut la première de toutes (à relire).
 */
async function storyReadState(stories: StoryRecord[]): Promise<{ unread?: StoryRecord }> {
  for (const s of stories) {
    const read = (await getMeta<number>(`storyRead.${s.id}`)) != null;
    if (!read) return { unread: s };
  }
  return {};
}

/** Une station de repos toutes les `REST_EVERY` leçons (SPEC §5.4). */
export const REST_EVERY = 5;

/** Clé meta d'une station de repos faite (la valeur est sa date). */
export function restKey(lessonId: string): string {
  return `rest.${lessonId}`;
}

/**
 * Station de repos à faire maintenant : la dernière leçon terminée ferme un bloc de
 * `REST_EVERY` leçons, la station de ce bloc n'a pas été faite, et la leçon suivante n'est
 * pas encore commencée — elle se place ENTRE le contrôle et le cours suivant, jamais
 * rétroactivement au milieu d'une leçon en cours.
 */
async function pendingRest(lessons: Lesson[]): Promise<FlowState["restDue"]> {
  let last = -1;
  lessons.forEach((l, i) => {
    if (l.completedAt) last = i;
  });
  if (last < 0 || (last + 1) % REST_EVERY !== 0) return undefined;
  if (lessons[last + 1]?.startedAt) return undefined;
  const key = lessons[last].id;
  if ((await getMeta<number>(restKey(key))) != null) return undefined;
  return { key, lessonIds: lessons.slice(last + 1 - REST_EVERY, last + 1).map((l) => l.id) };
}

/** Contexte de la séance en cours, traqué par l'UI (FlowSession) — pas en DB. */
export interface FlowSessionCtx {
  lastActivity?: FlowActivityKind;
  mirrorDoneThisFlow?: boolean;
}

export async function gatherFlowState(
  ctx: FlowSessionCtx = {},
  now: Date = new Date(),
): Promise<FlowGathered> {
  const today = localDateString(now);
  const [lessons, stats, daily, stories] = await Promise.all([
    listLessons(),
    sessionStats(now),
    getSrsDaily(today),
    allStories(),
  ]);
  const settings = loadSettings();

  const current = lessons.find((l) => l.startedAt && !l.completedAt);
  const { unread } = current ? await storyReadState(current.stories) : {};
  // Après un contrôle échoué, les ratés pas encore repassés commandent la révision ciblée.
  const retake =
    current && current.examAttempts > 0 && !current.examPassed ? await examStatus(current.id) : undefined;
  const next = lessons.find((l) => !l.startedAt && !l.completedAt && !l.locked);
  const mirror = await currentMirrorCandidate(stories, now);
  const restDue = current ? undefined : await pendingRest(lessons);

  const state: FlowState = {
    dueCount: stats.dueCount,
    hasCards: stats.cardCount > 0,
    stepsToday: daily?.steps ?? 0,
    dailySteps: settings.dailySteps,
    flowMsToday: daily?.flowMs ?? 0,
    currentLesson: current
      ? {
          id: current.id,
          title: current.title,
          steps: current.steps,
          stepsDone: current.stepsDone,
          unreadStoryId: unread?.id,
          unreadStoryTitle: unread ? (unread.titleFr ?? unread.title) : undefined,
          anyStoryId: current.stories[0]?.id,
          ...(retake?.pendingItems.length ? { retakePending: retake.pendingItems } : {}),
        }
      : undefined,
    nextLesson: next ? { id: next.id, title: next.title, ready: next.state === "ready" } : undefined,
    ...(restDue ? { restDue } : {}),
    mirrorCandidate: mirror
      ? { storyId: mirror.storyId, title: mirror.title, ageDays: mirror.ageDays }
      : undefined,
    ...ctx,
  };
  return { state, lessons };
}
