// Rappel quotidien : Web Push « à vide » (tickle) déclenché par un cron.
//
// POURQUOI un serveur, alors que tout le reste est local — et pourquoi ça reste privé :
// aucun mécanisme purement local ne peut sonner à une heure choisie app fermée (le Periodic
// Background Sync est Chrome-installé-seulement et c'est le navigateur qui choisit l'heure ;
// iOS ne l'a pas du tout). Le Worker envoie donc un push SANS CHARGE UTILE : il ne transporte
// rien, il réveille juste le service worker, qui rédige la notification sur l'appareil depuis
// IndexedDB. Deux conséquences :
//   1. aucun chiffrement aes128gcm à écrire — seule la signature VAPID (ES256) est requise ;
//   2. le serveur ne stocke qu'un endpoint opaque, une heure et un fuseau. Jamais une carte,
//      jamais un mot, jamais un compte de révisions.
//
// Secrets absents → 503 « push_unconfigured » et cron inerte, comme PROGRESS absent donne
// « sync_unconfigured » (progress.ts) : un fork sans secrets garde les rappels locaux.

import { sha256Hex } from "./cache";

export interface PushEnvLike {
  /** Point P-256 non compressé (65 octets), base64url — aussi envoyé au client au build. */
  VAPID_PUBLIC_KEY?: string;
  /** Scalaire privé `d` (32 octets), base64url — le champ `d` d'un JWK EC. */
  VAPID_PRIVATE_KEY?: string;
  /** « mailto:… » ou « https://… ». Apple REFUSE un `sub` absent ou d'une autre forme. */
  VAPID_SUBJECT?: string;
}

/** Un appareil abonné. Rien d'autre : ni identité, ni contenu d'étude. */
export interface PushRecord {
  endpoint: string;
  /** Heure LOCALE du rappel (0-23). */
  hour: number;
  /** Fuseau IANA (« Europe/Paris ») : c'est lui qui gère l'heure d'été côté serveur. */
  zone: string;
  /** Décalage figé à l'abonnement — repli si le runtime ignore `zone`. */
  tzOffsetMinutes: number;
  /** Date locale « YYYY-MM-DD » déjà bouclée : ne pas notifier ce jour-là. */
  skipDate?: string;
  createdAt: number;
  lastSentAt?: number;
}

const PREFIX = "push/";

/** Nombre d'abonnements traités par exécution du cron — garde-fou, jamais atteint en usage réel. */
const MAX_PER_RUN = 200;

/**
 * Fenêtre de RATTRAPAGE, en heures locales, après l'heure choisie. Les crons Cloudflare sont
 * au mieux de l'effort : une passe sautée ou décalée au-delà de l'heure ronde mangerait
 * silencieusement le rappel de la journée — un « je n'ai rien reçu » impossible à distinguer
 * d'un bug. La passe suivante repêche donc l'abonnement, dans la même journée locale.
 */
const CATCHUP_HOURS = 2;

/** Bornes de validation du corps de /push/subscribe. */
const MAX_ENDPOINT = 1024;
const MAX_ZONE = 64;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type JsonFn = (body: unknown, status?: number, headers?: Record<string, string>) => Response;

// ---- base64url ------------------------------------------------------------------

export function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Clé R2 d'un abonnement : le hash de l'endpoint, comme progressKey pour le code de session
 *  — un listing accidentel du bucket ne révèle aucun endpoint utilisable. */
export async function pushKey(endpoint: string): Promise<string> {
  return `${PREFIX}${await sha256Hex(endpoint)}.json`;
}

/** Les trois secrets sont-ils là ? Sinon tout le module est inerte. */
export function pushConfigured(env: PushEnvLike): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

// ---- VAPID ----------------------------------------------------------------------

/**
 * En-tête `Authorization` VAPID pour un endpoint donné.
 *
 * Deux détails qui font échouer silencieusement quand on les rate :
 *  - `crypto.subtle.sign` en ECDSA renvoie déjà `r||s` brut (64 o), soit EXACTEMENT le
 *    format attendu par JWS — surtout ne pas y voir du DER à convertir ;
 *  - `aud` est l'ORIGINE de l'endpoint, pas son URL complète.
 * `exp` est volontairement court (12 h) : au-delà de 24 h, Apple rejette le jeton.
 */
export async function vapidAuth(
  endpoint: string,
  env: PushEnvLike,
  now: number = Date.now(),
): Promise<string> {
  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY!);
  // `x`/`y` se déduisent du point non compressé (0x04 || x || y) → un seul secret public à stocker.
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: env.VAPID_PRIVATE_KEY!,
    x: bytesToB64u(pub.subarray(1, 33)),
    y: bytesToB64u(pub.subarray(33, 65)),
  };
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const head = bytesToB64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT,
      }),
    ),
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(`${head}.${body}`),
  );
  return `vapid t=${head}.${body}.${bytesToB64u(new Uint8Array(sig))}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Un 404/410 du service de push signifie « cet abonnement est mort » → on le supprime. */
export function isGone(status: number): boolean {
  return status === 404 || status === 410;
}

/** Envoie le push vide. Renvoie le statut HTTP du service de push (0 = échec réseau). */
export async function sendTickle(
  endpoint: string,
  env: PushEnvLike,
  now: number = Date.now(),
): Promise<number> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(endpoint, env, now),
        // Aucun corps : ni Content-Type ni Content-Encoding, sinon les services de push
        // attendent une charge chiffrée et répondent 400.
        TTL: "3600",
        Urgency: "normal",
      },
    });
    return res.status;
  } catch (e) {
    console.warn(`push: échec réseau ${String(e)}`);
    return 0;
  }
}

// ---- Heure locale et éligibilité (purs, testables) ------------------------------

/**
 * Heure (0-23) et date « YYYY-MM-DD » LOCALES d'un fuseau IANA. `formatToParts` évite de
 * parser une chaîne localisée, et `hourCycle: "h23"` évite le « 24 » de minuit renvoyé par
 * certains moteurs avec `hour12: false`.
 */
export function localHM(
  now: Date,
  zone: string,
  fallbackOffsetMin: number,
): { hour: number; date: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = parseInt(get("hour"), 10);
    if (DATE_RE.test(date) && Number.isFinite(hour)) return { hour, date };
  } catch {
    /* fuseau inconnu du runtime → repli sur le décalage figé à l'abonnement */
  }
  // `getTimezoneOffset()` est POSITIF à l'ouest de Greenwich (UTC+2 → -120) : on soustrait.
  const iso = new Date(now.getTime() - fallbackOffsetMin * 60_000).toISOString();
  return { hour: Number(iso.slice(11, 13)), date: iso.slice(0, 10) };
}

/** Cet abonnement doit-il être notifié maintenant ? Pur : c'est le cœur testable du cron. */
export function shouldSendNow(r: PushRecord, now: Date): boolean {
  const { hour, date } = localHM(now, r.zone, r.tzOffsetMinutes);
  if (r.skipDate === date) return false; // journée déjà bouclée
  // Un seul rappel par journée locale, même si le cron repasse (dérive, redéploiement).
  if (r.lastSentAt && localHM(new Date(r.lastSentAt), r.zone, r.tzOffsetMinutes).date === date) {
    return false;
  }
  if (hour === r.hour) return true;
  // Rattrapage d'une passe manquée (voir CATCHUP_HOURS). Jamais pour un abonnement créé
  // aujourd'hui : activer les rappels à 20 h pour 19 h ne doit pas sonner dans la minute.
  if (hour <= r.hour || hour > r.hour + CATCHUP_HOURS) return false;
  return localHM(new Date(r.createdAt), r.zone, r.tzOffsetMinutes).date !== date;
}

// ---- Validation du corps --------------------------------------------------------

export interface SubscribeInput {
  endpoint: string;
  hour: number;
  zone: string;
  tzOffsetMinutes: number;
  /** Absent = inchangé ; "" = effacer ; une date = journée bouclée. */
  skipDate?: string;
}

/**
 * Valide le corps de /push/subscribe. `null` = 400. L'endpoint doit être une URL https
 * publique : sans ce garde-fou, le Worker deviendrait un relais de requêtes arbitraires.
 */
export function parseSubscribe(body: unknown): SubscribeInput | null {
  const b = body as Partial<SubscribeInput> | null;
  if (!b || typeof b.endpoint !== "string" || b.endpoint.length > MAX_ENDPOINT) return null;
  let url: URL;
  try {
    url = new URL(b.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.hostname.endsWith(".local")) {
    return null;
  }
  const hour = Number(b.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const zone = typeof b.zone === "string" && b.zone.length <= MAX_ZONE ? b.zone : "";
  const off = Number(b.tzOffsetMinutes);
  const tzOffsetMinutes = Number.isFinite(off) && Math.abs(off) <= 16 * 60 ? off : 0;
  if (b.skipDate !== undefined && b.skipDate !== "" && !DATE_RE.test(String(b.skipDate))) {
    return null;
  }
  return { endpoint: b.endpoint, hour, zone, tzOffsetMinutes, skipDate: b.skipDate };
}

/**
 * Fusionne une demande d'abonnement avec l'enregistrement existant. `skipDate` absent laisse
 * la valeur en place (une bascule de réglage ne doit pas rouvrir la journée déjà bouclée),
 * "" l'effface (l'app a recalculé : la journée n'est plus finie).
 */
export function mergeRecord(
  input: SubscribeInput,
  existing: PushRecord | null,
  now: number,
): PushRecord {
  const skipDate = input.skipDate === undefined ? existing?.skipDate : input.skipDate || undefined;
  return {
    endpoint: input.endpoint,
    hour: input.hour,
    zone: input.zone || existing?.zone || "UTC",
    tzOffsetMinutes: input.tzOffsetMinutes,
    ...(skipDate ? { skipDate } : {}),
    createdAt: existing?.createdAt ?? now,
    ...(existing?.lastSentAt ? { lastSentAt: existing.lastSentAt } : {}),
  };
}

// ---- Handlers HTTP --------------------------------------------------------------

async function readRecord(bucket: R2Bucket, key: string): Promise<PushRecord | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return (await obj.json()) as PushRecord;
  } catch {
    return null; // objet corrompu : on le réécrit proprement
  }
}

async function writeRecord(bucket: R2Bucket, key: string, rec: PushRecord): Promise<void> {
  await bucket.put(key, JSON.stringify(rec), {
    httpMetadata: { contentType: "application/json" },
  });
}

/**
 * POST /push/subscribe — upsert idempotent. Sert AUSSI à signaler la journée bouclée
 * (`skipDate`) : un seul endpoint plutôt que deux pour la même écriture.
 * Appelé à chaque démarrage de l'app → c'est ce qui rafraîchit le fuseau (heure d'été).
 */
export async function handlePushSubscribe(
  req: Request,
  bucket: R2Bucket | undefined,
  env: PushEnvLike,
  json: JsonFn,
): Promise<Response> {
  if (!bucket || !pushConfigured(env)) return json({ error: "push_unconfigured" }, 503);
  const input = parseSubscribe(await req.json().catch(() => null));
  if (!input) return json({ error: "bad_subscription" }, 400);

  const key = await pushKey(input.endpoint);
  const rec = mergeRecord(input, await readRecord(bucket, key), Date.now());
  await writeRecord(bucket, key, rec);
  return json({ ok: true, hour: rec.hour, zone: rec.zone });
}

/** POST /push/unsubscribe — l'utilisateur a coupé les rappels : on oublie l'appareil. */
export async function handlePushUnsubscribe(
  req: Request,
  bucket: R2Bucket | undefined,
  env: PushEnvLike,
  json: JsonFn,
): Promise<Response> {
  if (!bucket || !pushConfigured(env)) return json({ error: "push_unconfigured" }, 503);
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) return json({ error: "bad_subscription" }, 400);
  await bucket.delete(await pushKey(endpoint));
  return json({ ok: true });
}

// ---- Cron ----------------------------------------------------------------------

export interface CronReport {
  sent: number;
  removed: number;
  skipped: number;
}

/**
 * Passe horaire : pour chaque abonnement dont l'heure locale correspond et dont la journée
 * n'est pas bouclée, envoie le push vide. Un échec sur un abonnement n'arrête pas les autres.
 */
export async function runPushCron(
  bucket: R2Bucket | undefined,
  env: PushEnvLike,
  now: Date = new Date(),
): Promise<CronReport> {
  const report: CronReport = { sent: 0, removed: 0, skipped: 0 };
  if (!bucket || !pushConfigured(env)) return report;

  const listed = await bucket.list({ prefix: PREFIX, limit: MAX_PER_RUN });
  for (const obj of listed.objects) {
    const rec = await readRecord(bucket, obj.key);
    if (!rec?.endpoint) {
      await bucket.delete(obj.key);
      report.removed++;
      continue;
    }
    if (!shouldSendNow(rec, now)) {
      report.skipped++;
      continue;
    }
    const status = await sendTickle(rec.endpoint, env, now.getTime());
    if (isGone(status)) {
      await bucket.delete(obj.key);
      report.removed++;
      continue;
    }
    if (status >= 200 && status < 300) {
      await writeRecord(bucket, obj.key, { ...rec, lastSentAt: now.getTime() });
      report.sent++;
    } else {
      // 429 ou 5xx : transitoire, on ne marque rien → la passe suivante réessaiera.
      console.warn(`push: HTTP ${status} pour ${new URL(rec.endpoint).host}`);
      report.skipped++;
    }
  }
  if (listed.truncated) console.warn(`push: plus de ${MAX_PER_RUN} abonnements, reste ignoré`);
  return report;
}
