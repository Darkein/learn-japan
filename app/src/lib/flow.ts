// Flux d'étude continu : l'app enchaîne les activités (omikuji → révisions → lecture →
// leçon → miroir) avec un point de sortie à chaque checkpoint — on reste 5 minutes ou
// 2 heures, tout compte.
//
// RÈGLE DURE : `pickNext` est PURE et DÉTERMINISTE — aucun Math.random, aucun accès IO.
// Même FlowState → même activité, entre l'accueil et le checkpoint, et dans les tests.
// Tout l'IO vit dans `gatherFlowState` (collecteur mince, non testé unitairement).

import { SRS } from "./config";
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
  | "exam" // contrôle de la leçon en cours (le 関所) : il ouvre la suivante
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
    /** Contrôle ouvert (leçon assez travaillée) et pas encore réussi. */
    examDue?: boolean;
  };
  nextLesson?: { id: string; title: string; ready: boolean };
  mirrorCandidate?: { storyId: string; title: string; ageDays: number };
  omikuji: { drawnToday: boolean; completedToday: boolean };
  lastActivity?: FlowActivityKind;
  /** Blocs de renforcement déjà terminés dans cette session de flux (0 hors flux). */
  reinforceCountThisFlow?: number;
  /** Omikuji déjà proposée dans cette session de flux (tirée OU refermée sans tirer). */
  omikujiOfferedThisFlow?: boolean;
}

/** Le renforcement s'arrête après ce nombre de blocs par session de flux : le dû restant
 *  attend demain — le flux doit toujours pouvoir se terminer. */
export const MAX_REINFORCE_PER_FLOW = 2;

/**
 * Choisit LA meilleure activité suivante. Barème, dans l'ordre :
 * ① omikuji en ouverture du flux si pas encore tirée aujourd'hui — une seule proposition
 *    par session de flux (refermée sans tirer, elle attend la prochaine session) ;
 * ② lecture d'une histoire de la leçon en cours juste après un bloc d'effort
 *    (révision OU renforcement — alternance travail/plaisir) ;
 * ③ révisions si des cartes sont dues et l'objectif du jour pas atteint ;
 * ④ contrôle de la leçon en cours dès qu'il est ouvert : c'est lui qui débloque la
 *    suite, il passe donc AVANT la découverte d'une nouvelle leçon ;
 * ⑤ prochaine leçon si elle est prête et débloquée ;
 * ⑥ relecture-miroir si un candidat existe ;
 * ⑦ histoire non lue de la leçon en cours (même sans révision préalable) ;
 * ⑧ renforcement si backlog dû restant, plafonné à MAX_REINFORCE_PER_FLOW blocs ;
 * ⑨ done — le flux propose toujours une sortie élégante, même s'il reste du dû.
 */
export function pickNext(state: FlowState): FlowActivity {
  const s = state;
  const unread = s.currentLesson?.unreadStoryId;

  // La garde `lastActivity` couvre les appelants qui ne traquent pas la session de flux
  // (rappels) ; dans le flux, c'est `omikujiOfferedThisFlow` qui fait foi.
  if (!s.omikuji.drawnToday && !s.omikujiOfferedThisFlow && s.lastActivity !== "omikuji") {
    return {
      kind: "omikuji",
      title: "Omikuji du jour",
      reason: "Tire ta fortune au temple — un petit défi t'attend.",
    };
  }
  if ((s.lastActivity === "review" || s.lastActivity === "reinforce") && unread) {
    return readStory(s);
  }
  // Pas de garde anti-répétition ici : si rien d'autre à alterner, on enchaîne les blocs
  // de révision (sessions plafonnées à 30) jusqu'à l'objectif — c'est le cœur du flux.
  if (s.dueCount > 0 && s.reviewedToday < s.dailyGoal) {
    return {
      kind: "review",
      title: `Révisions (${s.dueCount} due${s.dueCount > 1 ? "s" : ""})`,
      reason: "L'objectif du jour n'est pas encore atteint.",
    };
  }
  if (s.currentLesson?.examDue && s.lastActivity !== "exam") {
    return {
      kind: "exam",
      refId: s.currentLesson.id,
      title: `Contrôle — ${s.currentLesson.title}`,
      reason: "Le poste de contrôle est ouvert : franchis la barrière pour ouvrir la suite.",
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
  // Renforcement plafonné : pas de garde `lastActivity`, c'est le compteur qui borne
  // (la règle ② intercale une lecture quand il y en a une). Au-delà du plafond, le dû
  // restant attend demain et le flux atteint `done`.
  if (s.dueCount > 0 && (s.reinforceCountThisFlow ?? 0) < MAX_REINFORCE_PER_FLOW) {
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

// ---- Prévisualisation (carte d'accueil) ------------------------------------------

export interface FlowPreviewStep {
  kind: FlowActivityKind;
  /** Libellé court en français, prêt à joindre : « l'omikuji du jour, puis 34 révisions ». */
  label: string;
}

/**
 * Déroule `pickNext` en simulant l'avancement d'une session de flux qui démarre :
 * les `n` prochaines étapes annoncées sur la carte d'accueil. Pure — ne mute pas `state`.
 * La phase de révision est annoncée comme UN pas (« 34 révisions »), pas bloc par bloc.
 */
export function previewFlow(state: FlowState, n = 3): FlowPreviewStep[] {
  const sim: FlowState = {
    ...state,
    currentLesson: state.currentLesson ? { ...state.currentLesson } : undefined,
    omikuji: { ...state.omikuji },
    lastActivity: undefined,
    reinforceCountThisFlow: 0,
    omikujiOfferedThisFlow: false,
  };
  const steps: FlowPreviewStep[] = [];
  while (steps.length < n) {
    const a = pickNext(sim);
    if (a.kind === "done") break;
    switch (a.kind) {
      case "omikuji":
        steps.push({ kind: a.kind, label: "l'omikuji du jour" });
        sim.omikuji.drawnToday = true;
        break;
      case "review":
        steps.push({
          kind: a.kind,
          label: `${sim.dueCount} révision${sim.dueCount > 1 ? "s" : ""}`,
        });
        sim.reviewedToday = sim.dailyGoal;
        sim.dueCount = 0;
        break;
      case "reinforce":
        steps.push({ kind: a.kind, label: "un bloc de renforcement" });
        sim.dueCount -= Math.min(sim.dueCount, SRS.sessionCap);
        sim.reinforceCountThisFlow = (sim.reinforceCountThisFlow ?? 0) + 1;
        break;
      case "read-story":
        steps.push({ kind: a.kind, label: "une lecture" });
        if (sim.currentLesson) sim.currentLesson.unreadStoryId = undefined;
        break;
      case "lesson":
        steps.push({ kind: a.kind, label: "une leçon" });
        sim.nextLesson = undefined;
        break;
      case "exam":
        steps.push({ kind: a.kind, label: "le contrôle de la leçon" });
        if (sim.currentLesson) sim.currentLesson.examDue = false;
        break;
      case "mirror":
        steps.push({ kind: a.kind, label: "une relecture-miroir" });
        sim.mirrorCandidate = undefined;
        break;
    }
    sim.lastActivity = a.kind;
  }
  return steps;
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

/** Contexte de la session de flux en cours, traqué par l'UI (FlowSession) — pas en DB. */
export interface FlowSessionCtx {
  lastActivity?: FlowActivityKind;
  reinforceCountThisFlow?: number;
  omikujiOfferedThisFlow?: boolean;
}

export async function gatherFlowState(
  ctx: FlowSessionCtx = {},
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
          examDue: current.examEligible && !current.examPassed,
        }
      : undefined,
    nextLesson: next ? { id: next.id, title: next.title, ready: next.state === "ready" } : undefined,
    mirrorCandidate: mirror
      ? { storyId: mirror.storyId, title: mirror.title, ageDays: mirror.ageDays }
      : undefined,
    omikuji: { drawnToday: !!omikujiRec, completedToday: !!omikujiRec?.completedAt },
    ...ctx,
  };
  return { state, lessons };
}
