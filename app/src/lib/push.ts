// Abonnement au rappel quotidien (Web Push) — côté app.
//
// Ce qui quitte l'appareil : un endpoint opaque fourni par le navigateur, l'heure choisie et
// le fuseau. RIEN d'autre. Le push envoyé par le Worker est VIDE : c'est le service worker
// qui rédige la notification depuis IndexedDB (voir sw.ts et reminderText.ts).
//
// Tout est best-effort et silencieux : sans clé VAPID au build, sans `pushManager` (iOS non
// installé, navigateur ancien) ou sans Worker joignable, on renvoie un état et l'app garde
// ses rappels locaux (badge, notification à l'ouverture, periodic sync).

import { VAPID_PUBLIC_KEY, WORKER_URL } from "./config";
import { getMeta, putMeta } from "./db";
import type { ReminderSettings } from "./settings";

/** Endpoint du dernier abonnement, pour pouvoir se désabonner côté Worker. Clé LOCALE à
 *  l'appareil : le préfixe `push:` est exclu de la sync (voir LOCAL_META dans sync.ts). */
const ENDPOINT_KEY = "push:endpoint";

const TIMEOUT_MS = 8_000;

export type PushState =
  | "off" // rappels désactivés par l'utilisateur
  | "subscribed" // tout est en place
  | "denied" // permission notifications absente ou refusée
  | "unsupported" // pas de pushManager (iOS hors écran d'accueil, navigateur ancien)
  | "unconfigured" // pas de clé VAPID au build, ou Worker sans secrets
  | "error"; // Worker injoignable

/** base64url → octets, pour `applicationServerKey`. Pur : testé.
 *  Le buffer est alloué explicitement : `new Uint8Array(n)` est typé sur `ArrayBufferLike`,
 *  que `applicationServerKey` (BufferSource) refuse depuis les lib TS à ArrayBuffer génériques. */
export function urlB64ToUint8Array(b64u: string) {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64u.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * `navigator.serviceWorker.ready` n'est pas une promesse qui échoue : sans aucun SW enregistré
 * (dev — main.tsx ne l'enregistre qu'en PROD), elle reste pendante POUR TOUJOURS. On la borne
 * donc, sinon les réglages n'afficheraient jamais d'état. Généreux (15 s) : sur une première
 * visite réelle, le SW met parfois quelques secondes à s'activer, et un échec ici est sans
 * conséquence — le démarrage suivant réessaie.
 */
async function swReady(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
}

/** Le Web Push est-il envisageable ici ? (sert à l'UI pour expliquer plutôt que d'échouer) */
export function pushAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/**
 * S'abonne (ou se réabonne) et déclare l'heure au Worker.
 *
 * `skipDate` : absent = laisser le marqueur « journée bouclée » tel quel (une bascule de
 * réglage ne doit pas rouvrir une journée déjà finie) ; `""` = l'effacer ; une date = la poser.
 *
 * Appelée à CHAQUE démarrage de l'app : c'est ce qui rafraîchit le fuseau (passage à l'heure
 * d'été) et répare un abonnement révoqué par le navigateur, pour un coût nul.
 */
export async function syncPushSubscription(
  reminders: ReminderSettings,
  skipDate?: string,
): Promise<PushState> {
  if (!reminders.enabled) {
    await unsubscribePush();
    return "off";
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return "denied";
  if (!pushAvailable()) return VAPID_PUBLIC_KEY ? "unsupported" : "unconfigured";

  try {
    const reg = await swReady();
    if (!reg?.pushManager) return "unsupported";
    const sub = await getOrCreateSubscription(reg);
    await putMeta(ENDPOINT_KEY, sub.endpoint);

    const res = await fetch(`${WORKER_URL}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        hour: reminders.hour,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Positif à l'ouest de Greenwich (UTC+2 → -120) : le Worker applique la même convention.
        tzOffsetMinutes: new Date().getTimezoneOffset(),
        ...(skipDate === undefined ? {} : { skipDate }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 503 = Worker sans secrets VAPID : ce n'est pas une panne, c'est une config absente.
    if (res.status === 503) return "unconfigured";
    return res.ok ? "subscribed" : "error";
  } catch {
    return "error";
  }
}

/**
 * Abonnement existant, sinon nouveau. Un changement de clé VAPID rend l'ancien abonnement
 * inutilisable (`subscribe` lève alors) : on le jette et on repart une fois — sans ça, les
 * rappels resteraient morts jusqu'à une réinstallation de l'app.
 */
async function getOrCreateSubscription(
  reg: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const applicationServerKey = urlB64ToUint8Array(VAPID_PUBLIC_KEY);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const same = existing.options?.applicationServerKey;
    if (!same || sameKey(same, applicationServerKey)) return existing;
    await existing.unsubscribe().catch(() => {});
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
}

function sameKey(a: ArrayBuffer, b: Uint8Array): boolean {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Coupe les rappels : désabonnement navigateur ET oubli côté Worker (plus rien ne sera envoyé). */
export async function unsubscribePush(): Promise<void> {
  const stored = await getMeta<string>(ENDPOINT_KEY).catch(() => undefined);
  let endpoint = stored;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await swReady();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
      }
    }
  } catch {
    /* pas de SW prêt : on tente quand même l'oubli côté Worker avec l'endpoint mémorisé */
  }
  if (!endpoint) return;
  try {
    await fetch(`${WORKER_URL}/push/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /* Worker injoignable : le rappel arrivera peut-être encore une fois, sans gravité. */
  }
  await putMeta(ENDPOINT_KEY, "").catch(() => {});
}
