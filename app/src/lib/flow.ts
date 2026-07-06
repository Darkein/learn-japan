// Flux d'étude continu : l'app enchaîne les activités (révisions → lecture → leçon →
// omikuji → miroir) avec un point de sortie à chaque checkpoint — on reste 5 minutes ou
// 2 heures, tout compte.
//
// RÈGLE DURE : `pickNext` est PURE et DÉTERMINISTE — aucun Math.random, aucun accès IO.
// Même FlowState → même activité, entre l'accueil et le checkpoint, et dans les tests.
// Tout l'IO vit dans `gatherFlowState` (collecteur mince, non testé unitairement).

import {
  allStories,
  getMeta,
  getOmikuji,
  getSrsDaily,
  localDateString,
  type StoryRecord,
} from "./db";
import { listLessons, type Lesson } from "./lessons";
import { currentMirrorCandidate } from "./mirror";
import { sessionStats } from "./reviewSession";
import { loadSettings } from "./settings";

export type FlowActivityKind =
  | "review" // cartes dues, objectif du jour pas atteint
  | "reinforce" // objectif atteint mais backlog dû
  | "read-story" // lire une histoire de la leçon en cours
  | "lesson" // découvrir la prochaine leçon prête
  | "mirror" // relecture-miroir (une vieille histoire, pour mesurer le chemin)
  | "omikuji" // tirage du jour
  | "done"; // sortie naturelle

export interface FlowActivity {
  kind: FlowActivityKind;
  /** Cible concrète : storyId (read-story/mirror) ou lessonId (lesson). */
  refId?: string;
  /** Libellé du bouton « Continuer avec : … ». */
  title: string;
  /** Justification courte affichée au checkpoint. */
  reason: string;
}

export interface FlowState {
  dueCount: number;
  newCount: number;
  reviewedToday: number;
  dailyGoal: number;
  flowMsToday: number;
  currentLesson?: {
    id: string;
    title: string;
    /** Première histoire de la leçon jamais ouverte (meta storyRead absent). */
    unreadStoryId?: string;
    unreadStoryTitle?: string;
  };
  nextLesson?: { id: string; title: string; ready: boolean };
  mirrorCandidate?: { storyId: string; title: string; ageDays: number };
  omikuji: { drawnToday: boolean; completedToday: boolean };
  lastActivity?: FlowActivityKind;
}

const OMIKUJI_AFTER_MS = 5 * 60 * 1000;

/**
 * Choisit LA meilleure activité suivante. Barème, dans l'ordre :
 * ① lecture d'une histoire de la leçon en cours juste après un bloc de révision
 *    (alternance travail/plaisir) ;
 * ② révisions si des cartes sont dues et l'objectif du jour pas atteint ;
 * ③ omikuji si pas encore tiré et ≥ 5 min de flux (le tirage se mérite) ;
 * ④ prochaine leçon si elle est prête et débloquée ;
 * ⑤ relecture-miroir si un candidat existe ;
 * ⑥ histoire non lue de la leçon en cours (même sans révision préalable) ;
 * ⑦ renforcement si backlog dû restant ;
 * ⑧ done — le flux propose toujours une sortie élégante.
 */
export function pickNext(state: FlowState): FlowActivity {
  const s = state;
  const unread = s.currentLesson?.unreadStoryId;

  if (s.lastActivity === "review" && unread) return readStory(s);
  // Pas de garde anti-répétition ici : si rien d'autre à alterner, on enchaîne les blocs
  // de révision (sessions plafonnées à 30) jusqu'à l'objectif — c'est le cœur du flux.
  if (s.dueCount > 0 && s.reviewedToday < s.dailyGoal) {
    return {
      kind: "review",
      title: `Révisions (${s.dueCount} due${s.dueCount > 1 ? "s" : ""})`,
      reason: "L'objectif du jour n'est pas encore atteint.",
    };
  }
  if (!s.omikuji.drawnToday && s.flowMsToday >= OMIKUJI_AFTER_MS && s.lastActivity !== "omikuji") {
    return {
      kind: "omikuji",
      title: "Omikuji du jour",
      reason: "Tire ta fortune au temple — un petit défi t'attend.",
    };
  }
  if (s.nextLesson?.ready && s.lastActivity !== "lesson") {
    return {
      kind: "lesson",
      refId: s.nextLesson.id,
      title: `Leçon — ${s.nextLesson.title}`,
      reason: "La leçon suivante est prête.",
    };
  }
  if (s.mirrorCandidate && s.lastActivity !== "mirror") {
    return {
      kind: "mirror",
      refId: s.mirrorCandidate.storyId,
      title: `Relecture-miroir — ${s.mirrorCandidate.title}`,
      reason: `Tu l'as lue il y a ${s.mirrorCandidate.ageDays} jours — mesure le chemin parcouru.`,
    };
  }
  if (unread && s.lastActivity !== "read-story") return readStory(s);
  // Renforcement en boucle tant qu'il reste du dû : la sortie est offerte à chaque
  // checkpoint, c'est l'utilisateur qui décide de rester (5 min) ou de vider (2 h).
  if (s.dueCount > 0) {
    return {
      kind: "reinforce",
      title: `Renforcement (${s.dueCount} restante${s.dueCount > 1 ? "s" : ""})`,
      reason: "Objectif atteint — consolide ce qui reste dû, si tu en as envie.",
    };
  }
  return {
    kind: "done",
    title: "Terminer pour aujourd'hui",
    reason: "Tout est fait pour aujourd'hui. La route t'attend demain.",
  };
}

function readStory(s: FlowState): FlowActivity {
  return {
    kind: "read-story",
    refId: s.currentLesson!.unreadStoryId,
    title: `Lecture — ${s.currentLesson!.unreadStoryTitle ?? "histoire de la leçon"}`,
    reason: "Une histoire de ta leçon t'attend — le plaisir après l'effort.",
  };
}

// ---- Collecteur IO -------------------------------------------------------------

export interface FlowGathered {
  state: FlowState;
  /** Leçons déjà chargées — réutilisables par l'appelant (Tōkaidō) sans repayer listLessons. */
  lessons: Lesson[];
}

/** Première histoire de la leçon jamais ouverte (meta `storyRead.<id>` absent). */
async function firstUnreadStory(stories: StoryRecord[]): Promise<StoryRecord | undefined> {
  for (const s of stories) {
    if ((await getMeta<number>(`storyRead.${s.id}`)) == null) return s;
  }
  return undefined;
}

export async function gatherFlowState(
  lastActivity?: FlowActivityKind,
  now: Date = new Date(),
): Promise<FlowGathered> {
  const today = localDateString(now);
  const [lessons, stats, daily, omikujiRec, stories] = await Promise.all([
    listLessons(),
    sessionStats(now),
    getSrsDaily(today),
    getOmikuji(today),
    allStories(),
  ]);
  const settings = loadSettings();

  const current = lessons.find((l) => l.startedAt && !l.completedAt);
  const unread = current ? await firstUnreadStory(current.stories) : undefined;
  const next = lessons.find((l) => !l.startedAt && !l.completedAt && !l.locked);
  const mirror = await currentMirrorCandidate(stories, now);

  const state: FlowState = {
    dueCount: stats.dueCount,
    newCount: stats.newCount,
    reviewedToday: daily?.reviewed ?? 0,
    dailyGoal: settings.dailyGoal,
    flowMsToday: daily?.flowMs ?? 0,
    currentLesson: current
      ? {
          id: current.id,
          title: current.title,
          unreadStoryId: unread?.id,
          unreadStoryTitle: unread ? (unread.titleFr ?? unread.title) : undefined,
        }
      : undefined,
    nextLesson: next ? { id: next.id, title: next.title, ready: next.state === "ready" } : undefined,
    mirrorCandidate: mirror
      ? { storyId: mirror.storyId, title: mirror.title, ageDays: mirror.ageDays }
      : undefined,
    omikuji: { drawnToday: !!omikujiRec, completedToday: !!omikujiRec?.completedAt },
    lastActivity,
  };
  return { state, lessons };
}
