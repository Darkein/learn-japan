/// <reference lib="webworker" />
// Service worker custom (injectManifest). Reproduit EXACTEMENT le comportement de
// l'ancienne config generateSW — precache + autoUpdate (skipWaiting/clientsClaim) +
// runtime cache `kuromoji-dict` (même cacheName : ne pas re-télécharger ~12 Mo) —
// et ajoute les rappels du programme du jour : Web Push (app fermée, à l'heure choisie)
// et periodic background sync en repli, tous deux vers une notification locale.

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { WORKER_URL } from "./lib/config";
import { countDueFromIndexedDB, readMetaRaw, writeMetaRaw } from "./lib/dueCount";
import { REMINDER_TAG, reminderNotification, type ReminderHint } from "./lib/reminderText";
import type { ReminderSettings } from "./lib/settings";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Mise à jour pilotée par l'app (registerType `prompt`) : on n'appelle plus
// `skipWaiting()` à l'installation. Le nouveau SW reste en attente jusqu'à ce que l'app
// envoie le message SKIP_WAITING (via `updateSW(true)`), au moment choisi — typiquement
// au retour dans l'app, pour ne jamais recharger en pleine lecture. Voir src/main.tsx.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") self.skipWaiting();
});

// Dictionnaire kuromoji (~12 Mo) : exclu du precache, servi en CacheFirst à la demande.
registerRoute(
  ({ url }) => url.pathname.includes("/dict/"),
  new CacheFirst({
    cacheName: "kuromoji-dict",
    plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// ---- Rappels du programme du jour (app fermée) ------------------------------------

const PERIODIC_SYNC_TAG = "revision-reminder";

function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Affiche le rappel du jour. Le texte est calculé ICI, sur l'appareil : le compte de cartes
 * dues est relu dans IndexedDB (donc exact à la seconde), l'activité proposée vient de
 * l'indice que l'app a laissé en meta (voir refreshReminderState). Rien de tout cela n'a
 * transité par le réseau.
 */
async function showDailyReminder(now: Date = new Date()): Promise<void> {
  const today = localDateString(now);
  const due = await countDueFromIndexedDB(now);
  const hint = await readMetaRaw<ReminderHint>("reminder.hint");
  const lastEvent = await readMetaRaw<string>("reminder.lastEvent");
  await writeMetaRaw("reminder.lastShown", today);
  const nav = self.navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> };
  if (nav.setAppBadge && due > 0) await nav.setAppBadge(due).catch(() => {});
  const { title, body, eventShown } = reminderNotification(due, hint, today, lastEvent);
  // Mémorise le rendez-vous annoncé : demain, ce sera au tour d'autre chose.
  if (eventShown) await writeMetaRaw("reminder.lastEvent", eventShown);
  await self.registration.showNotification(title, { body, tag: REMINDER_TAG, icon: "icon.svg" });
}

// Web Push : le push est VIDE (il ne transporte rien, il réveille juste ce SW). Il DOIT
// aboutir à une notification visible — c'est le contrat `userVisibleOnly`, et à défaut Chrome
// finit par afficher « ce site a été mis à jour en arrière-plan » puis révoque le push.
// Aucune garde d'heure ici : le Worker a déjà choisi le moment et sauté les journées bouclées.
self.addEventListener("push", (event) => {
  (event as ExtendableEvent).waitUntil(showDailyReminder());
});

/**
 * Le navigateur a renouvelé l'abonnement (rotation de clé, réinstallation) : on déclare le
 * nouvel endpoint. L'ancien restera côté Worker jusqu'au prochain cron, qui le supprimera sur
 * le 410 du service de push. Sans clé VAPID à manipuler ici : `newSubscription` suffit, et à
 * défaut l'abonnement courant — sinon le prochain démarrage de l'app s'en chargera.
 */
async function onSubscriptionChange(next?: PushSubscription): Promise<void> {
  const reminders = await readMetaRaw<ReminderSettings>("reminders");
  if (!reminders?.enabled) return;
  const sub = next ?? (await self.registration.pushManager.getSubscription());
  if (!sub) return;
  await writeMetaRaw("push:endpoint", sub.endpoint);
  await fetch(`${WORKER_URL}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      hour: reminders.hour,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tzOffsetMinutes: new Date().getTimezoneOffset(),
    }),
  }).catch(() => {});
}

self.addEventListener("pushsubscriptionchange", (event) => {
  const e = event as ExtendableEvent & { newSubscription?: PushSubscription };
  e.waitUntil(onSubscriptionChange(e.newSubscription));
});

/**
 * Repli sans push (Chrome/Edge installé) : le navigateur choisit le moment, on garde donc la
 * garde d'heure et la garde « une fois par jour » ici. On se taît si l'app a noté que la
 * journée était bouclée — le Worker ne peut pas filtrer ce chemin.
 */
async function remindIfDue(): Promise<void> {
  const reminders = await readMetaRaw<ReminderSettings>("reminders");
  if (!reminders?.enabled) return;
  const now = new Date();
  if (now.getHours() < reminders.hour) return;
  const today = localDateString(now);
  if ((await readMetaRaw<string>("reminder.lastShown")) === today) return;
  const hint = await readMetaRaw<ReminderHint>("reminder.hint");
  if (hint?.date === today && hint.kind === "done") return;
  if ((await countDueFromIndexedDB(now)) === 0 && !hint) return; // rien à annoncer honnêtement
  await showDailyReminder(now);
}

self.addEventListener("periodicsync", (event) => {
  const e = event as ExtendableEvent & { tag: string };
  if (e.tag === PERIODIC_SYNC_TAG) e.waitUntil(remindIfDue());
});

// Tap sur la notification : focalise un onglet existant ou ouvre le flux d'étude.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients[0];
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow("/learn-japan/#/flux");
    })(),
  );
});
