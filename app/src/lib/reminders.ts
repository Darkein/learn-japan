// Rappels du programme du jour — côté app. Quatre mécanismes, du plus fiable au plus incertain :
// 1. Web Push (app fermée, à l'heure choisie) : le Worker envoie un push VIDE à l'heure dite,
//    le service worker rédige la notification sur l'appareil (voir lib/push.ts et sw.ts).
//    Seul mécanisme qui tienne la promesse « à 19 h », et le seul qui existe sur iOS.
// 2. Badge d'icône (App Badging API) : compte des cartes dues. Android/desktop installé.
// 3. Notification locale « à l'ouverture » : repli quand le push n'est pas disponible.
// 4. Periodic Background Sync : Chrome/Edge installé, fréquence décidée par le navigateur.
//
// CE QUI QUITTE L'APPAREIL : un endpoint de push opaque, l'heure choisie, le fuseau, et un
// drapeau « journée bouclée ». Jamais une carte, jamais un mot, jamais un compte de révisions —
// le contenu de la notification est calculé localement.

import { allGrammar, allVocab, getMeta, localDateString, putMeta, recentSrsDaily } from "./db";
import { gatherFlowState, pickNext, type FlowActivityKind, type FlowState } from "./flow";
import { syncPushSubscription } from "./push";
import { reminderItemPool } from "./reminderItem";
import {
  REMINDER_TAG,
  reminderNotification,
  type ReminderEvent,
  type ReminderHint,
} from "./reminderText";
import { sessionStats } from "./reviewSession";
import type { ReminderSettings } from "./settings";
import { reviewStreak } from "./stats";
import { isTrainableVocab } from "./vocabFaces";

export const PERIODIC_SYNC_TAG = "revision-reminder";

/** Clé meta lue par le service worker pour rédiger la notification (voir reminderText.ts). */
const HINT_KEY = "reminder.hint";
/** Dernier rendez-vous annoncé (miroir, leçon, histoire) : on ne le rejoue pas chaque soir. */
const LAST_EVENT_KEY = "reminder.lastEvent";

type NavigatorBadge = Navigator & {
  setAppBadge?: (n: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Met à jour le badge d'icône avec le nombre de cartes dues (no-op si non supporté). */
export async function updateBadge(count?: number): Promise<void> {
  const nav = navigator as NavigatorBadge;
  if (!nav.setAppBadge || !nav.clearAppBadge) return;
  try {
    const due = count ?? (await sessionStats()).dueCount;
    if (due > 0) await nav.setAppBadge(due);
    else await nav.clearAppBadge();
  } catch {
    /* Badging refusé (contexte non installé…) : sans gravité. */
  }
}

/** Enregistre le periodic sync si le navigateur le propose (sinon no-op silencieux). */
export async function ensurePeriodicSync(enabled: boolean): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (tag: string, opts: { minInterval: number }) => Promise<void>;
        unregister: (tag: string) => Promise<void>;
      };
    };
    if (!reg.periodicSync) return;
    if (enabled) {
      await reg.periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: 12 * 3600 * 1000 });
    } else {
      await reg.periodicSync.unregister(PERIODIC_SYNC_TAG);
    }
  } catch {
    /* Permission refusée ou API absente : le push et les replis locaux restent. */
  }
}

/**
 * Le rendez-vous du moment, s'il y en a un — INDÉPENDAMMENT du dû. `pickNext` sert le flux :
 * dès qu'une carte est due, il répond `review` et l'on ne saurait plus qu'une relecture-miroir
 * attend. Le rappel, lui, n'a qu'une phrase par jour à dépenser et préfère le rare au quotidien.
 * D'où cet ordre propre au rappel : le miroir (une quinzaine au mieux), puis la leçon
 * fraîchement débloquée, puis l'histoire jamais lue.
 */
function pickEvent(s: FlowState): ReminderEvent | undefined {
  if (s.mirrorCandidate) {
    return {
      key: `mirror:${s.mirrorCandidate.storyId}`,
      kind: "mirror",
      label: s.mirrorCandidate.title,
      ageDays: s.mirrorCandidate.ageDays,
    };
  }
  if (s.nextLesson?.ready) {
    return { key: `lesson:${s.nextLesson.id}`, kind: "lesson", label: s.nextLesson.title };
  }
  const storyId = s.currentLesson?.unreadStoryId;
  if (storyId) {
    return {
      key: `story:${storyId}`,
      kind: "read-story",
      label: s.currentLesson?.unreadStoryTitle,
    };
  }
  return undefined;
}

/**
 * La journée est-elle bouclée AU POINT DE FAIRE TAIRE le rappel du soir ?
 *
 * `pickNext` répondant `done` ne suffit pas : il décrit l'INSTANT présent, pas la journée.
 * Ouvrir l'app deux minutes le matin, quand rien n'est encore dû, donne déjà `done` — et le
 * rappel du soir serait annulé pour la journée entière, alors que des cartes deviendront dues
 * d'ici là. Le symptôme, côté utilisateur : « je ne reçois plus rien dès que j'ai lancé l'app ».
 *
 * On exige donc du TRAVAIL fait aujourd'hui, sous l'une des deux formes qui valent « c'est
 * fait » : l'objectif du jour atteint (même définition que la série, voir `reviewStreak`), ou
 * plus rien à faire APRÈS avoir révisé (journée courte : quatre cartes dues, quatre révisées).
 */
export function dayIsDone(s: FlowState, kind: FlowActivityKind): boolean {
  if (s.reviewedToday === 0) return false;
  return s.reviewedToday >= s.dailyGoal || kind === "done";
}

/**
 * Rafraîchit tout ce dont les rappels ont besoin, en UN seul parcours de l'état du flux :
 * le badge, l'indice de texte pour le service worker, et l'abonnement au push (heure + fuseau
 * + drapeau « journée bouclée »).
 *
 * Le SERVICE WORKER ne peut pas appeler `pickNext` (flow.ts tire reviewSession → ts-fsrs, qu'on
 * ne veut pas dans le bundle du SW — c'est déjà la raison d'être de dueCount.ts). D'où l'indice
 * pré-calculé en meta : l'app décide, le SW se contente de mettre en phrase.
 */
export async function refreshReminderState(reminders: ReminderSettings): Promise<void> {
  const today = localDateString();
  // `undefined` = laisser le marqueur « journée bouclée » tel quel côté Worker. C'est l'état
  // honnête tant qu'on n'a pas pu lire le flux : ni « c'est fait », ni « c'est à faire ».
  let skipDate: string | undefined;
  try {
    const { state } = await gatherFlowState();
    void updateBadge(state.dueCount);
    const next = pickNext(state);
    // Le peloton d'éléments et la série : le SW ne sait pas les calculer (ts-fsrs, log de
    // révisions), et ils restent dans le store `meta` local — rien ne part au push.
    const [vocab, grammar, daily] = await Promise.all([allVocab(), allGrammar(), recentSrsDaily(60)]);
    const hint: ReminderHint = {
      date: today,
      kind: next.kind,
      // Mêmes mots que la session : « tu te souviens de クロ ? » sur un mot qu'aucune
      // révision ne servira jamais (cf. isTrainableVocab) serait une fausse promesse.
      items: reminderItemPool(vocab.filter(isTrainableVocab), grammar, new Date()),
      event: pickEvent(state),
      streak: reviewStreak(daily, state.dailyGoal, today),
    };
    await putMeta(HINT_KEY, hint);
    // `""` efface le marqueur : la journée n'est plus bouclée (nouveau jour, cartes à venir).
    skipDate = dayIsDone(state, next.kind) ? today : "";
  } catch {
    // Base illisible / profil vierge : pas d'indice (le SW se rabattra sur son texte
    // générique). On enchaîne QUAND MÊME sur l'abonnement — sans lui, cet appareil ne
    // recevrait plus jamais de rappel à l'heure dite.
  }
  await syncPushSubscription(reminders, skipDate);
}

/**
 * Repli quand le push n'est pas disponible : à l'ouverture de l'app, si des révisions
 * attendent, que l'heure préférée est passée et qu'on n'a rien montré aujourd'hui, une
 * notification locale (une par jour, partagée avec le push via `reminder.lastShown`).
 */
export async function maybeNotifyOnOpen(reminders: ReminderSettings): Promise<void> {
  if (!reminders.enabled) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = new Date();
  if (now.getHours() < reminders.hour) return;
  const today = localDateString(now);
  if ((await getMeta<string>("reminder.lastShown")) === today) return;
  const due = (await sessionStats()).dueCount;
  // Contrairement au push (déclenché à l'heure dite, donc légitime même sans dû), ici
  // l'utilisateur vient d'ouvrir l'app : sans révision en attente, on ne le dérange pas.
  if (due === 0) return;
  await putMeta("reminder.lastShown", today);
  try {
    const reg = await navigator.serviceWorker.ready;
    const [hint, lastEvent] = await Promise.all([
      getMeta<ReminderHint>(HINT_KEY),
      getMeta<string>(LAST_EVENT_KEY),
    ]);
    const { title, body, eventShown } = reminderNotification(due, hint, today, lastEvent);
    if (eventShown) await putMeta(LAST_EVENT_KEY, eventShown);
    await reg.showNotification(title, { body, tag: REMINDER_TAG, icon: "icon.svg" });
  } catch {
    /* Pas de SW prêt (dev) : tant pis pour cette fois. */
  }
}

/**
 * Affiche le rappel immédiatement, tel qu'il apparaîtra le jour venu (bouton « Tester le
 * rappel » des réglages). Volontairement SANS écrire `reminder.lastShown` : un essai ne doit
 * pas consommer le rappel du jour. `false` = permission absente ou service worker indisponible.
 */
export async function showReminderNow(): Promise<boolean> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const today = localDateString();
    const due = (await sessionStats()).dueCount;
    // Un essai ne consomme rien : ni le rappel du jour, ni le rendez-vous en attente. On lit
    // `lastEvent` sans le réécrire, pour montrer exactement ce qui sortira le soir venu.
    const [hint, lastEvent] = await Promise.all([
      getMeta<ReminderHint>(HINT_KEY),
      getMeta<string>(LAST_EVENT_KEY),
    ]);
    const { title, body } = reminderNotification(due, hint, today, lastEvent);
    await reg.showNotification(title, { body, tag: REMINDER_TAG, icon: "icon.svg" });
    return true;
  } catch {
    return false;
  }
}

/** Initialisation au boot de l'app : état des rappels, sync périodique, rappel à l'ouverture. */
export function initReminders(reminders: ReminderSettings): () => void {
  void refreshReminderState(reminders);
  void ensurePeriodicSync(reminders.enabled);
  void maybeNotifyOnOpen(reminders);
  const onVisibility = () => {
    if (document.hidden) void updateBadge();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
