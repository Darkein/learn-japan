// Rappels de révisions — côté app. Trois mécanismes, du plus sûr au plus incertain :
// 1. Badge d'icône (App Badging API) : compte des cartes dues, mis à jour au boot, à la
//    fin d'une session et quand l'app passe en arrière-plan. Android/desktop installé.
// 2. Notification locale « à l'ouverture » : si des révisions attendent et que l'heure
//    préférée est passée, une fois par jour. Fonctionne partout où Notification existe.
// 3. Periodic Background Sync (app fermée) : Chrome/Edge installé uniquement, fréquence
//    décidée par le navigateur — jamais promis dans l'UI, le SW fait le reste (sw.ts).
// Tout est local : aucune donnée ne quitte l'appareil (pas de serveur de push).

import { getMeta, localDateString, putMeta } from "./db";
import { sessionStats } from "./reviewSession";
import type { ReminderSettings } from "./settings";

export const PERIODIC_SYNC_TAG = "revision-reminder";

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
    /* Permission refusée ou API absente : le badge et le rappel à l'ouverture restent. */
  }
}

/**
 * Repli honnête quand le periodic sync n'existe pas : à l'ouverture de l'app, si des
 * révisions attendent, que l'heure préférée est passée et qu'on n'a rien montré
 * aujourd'hui, une notification locale (une par jour).
 */
export async function maybeNotifyOnOpen(reminders: ReminderSettings): Promise<void> {
  if (!reminders.enabled) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const now = new Date();
  if (now.getHours() < reminders.hour) return;
  const today = localDateString(now);
  if ((await getMeta<string>("reminder.lastShown")) === today) return;
  const due = (await sessionStats()).dueCount;
  if (due === 0) return;
  await putMeta("reminder.lastShown", today);
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Learn Japan", {
      body: `${due} révision${due > 1 ? "s" : ""} t'attend${due > 1 ? "ent" : ""} — 5 minutes suffisent.`,
      tag: "revision",
      icon: "icon.svg",
    });
  } catch {
    /* Pas de SW prêt (dev) : tant pis pour cette fois. */
  }
}

/** Initialisation au boot de l'app : badge, sync périodique, rappel à l'ouverture. */
export function initReminders(reminders: ReminderSettings): () => void {
  void updateBadge();
  void ensurePeriodicSync(reminders.enabled);
  void maybeNotifyOnOpen(reminders);
  const onVisibility = () => {
    if (document.hidden) void updateBadge();
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}
