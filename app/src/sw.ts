/// <reference lib="webworker" />
// Service worker custom (injectManifest). Reproduit EXACTEMENT le comportement de
// l'ancienne config generateSW — precache + autoUpdate (skipWaiting/clientsClaim) +
// runtime cache `kuromoji-dict` (même cacheName : ne pas re-télécharger ~12 Mo) —
// et ajoute les rappels de révisions : periodic background sync → notification locale.

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { countDueFromIndexedDB, readMetaRaw, writeMetaRaw } from "./lib/dueCount";
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

// ---- Rappels de révisions (app fermée) -------------------------------------------

const PERIODIC_SYNC_TAG = "revision-reminder";

function localDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function remindIfDue(): Promise<void> {
  const reminders = await readMetaRaw<ReminderSettings>("reminders");
  if (!reminders?.enabled) return;
  const now = new Date();
  if (now.getHours() < reminders.hour) return;
  const today = localDateString(now);
  if ((await readMetaRaw<string>("reminder.lastShown")) === today) return;
  const due = await countDueFromIndexedDB(now);
  if (due === 0) return;
  await writeMetaRaw("reminder.lastShown", today);
  const nav = self.navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> };
  if (nav.setAppBadge) await nav.setAppBadge(due).catch(() => {});
  await self.registration.showNotification("Learn Japan", {
    body: `${due} révision${due > 1 ? "s" : ""} t'attend${due > 1 ? "ent" : ""} — 5 minutes suffisent.`,
    tag: "revision",
    icon: "icon.svg",
  });
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
