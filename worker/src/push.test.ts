// Rappel quotidien : heure locale (heure d'été comprise), éligibilité, validation du corps,
// signature VAPID réellement vérifiée, et passe de cron sur un bucket R2 mocké.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  b64uToBytes,
  bytesToB64u,
  handlePushSubscribe,
  isGone,
  localHM,
  mergeRecord,
  parseSubscribe,
  pushKey,
  runPushCron,
  shouldSendNow,
  vapidAuth,
  type PushEnvLike,
  type PushRecord,
} from "./push";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Mock R2 minimal : list/get/put/delete sur une Map, corps en texte JSON. */
function mockBucket() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { key, async json() { return JSON.parse(v); } };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix, limit }: { prefix: string; limit?: number }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      const kept = limit ? keys.slice(0, limit) : keys;
      return { objects: kept.map((key) => ({ key })), truncated: kept.length < keys.length };
    },
  } as unknown as R2Bucket & { store: Map<string, string> };
}

/** Vraies clés VAPID générées à la volée : la signature est ensuite VÉRIFIÉE, pas seulement lue. */
async function vapidEnv(): Promise<PushEnvLike & { verifyKey: CryptoKey }> {
  // `generateKey` est typé en union CryptoKey | CryptoKeyPair : on affirme la paire.
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return {
    VAPID_PUBLIC_KEY: bytesToB64u(raw),
    VAPID_PRIVATE_KEY: jwk.d!,
    VAPID_SUBJECT: "mailto:moi@example.test",
    verifyKey: pair.publicKey,
  };
}

const record = (over: Partial<PushRecord> = {}): PushRecord => ({
  endpoint: ENDPOINT,
  hour: 19,
  zone: "Europe/Paris",
  tzOffsetMinutes: -120,
  createdAt: 0,
  ...over,
});

describe("base64url", () => {
  it("fait l'aller-retour sans padding ni caractères d'URL", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const s = bytesToB64u(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect([...b64uToBytes(s)]).toEqual([...bytes]);
  });
});

describe("localHM", () => {
  it("suit l'heure d'été du fuseau, pas un décalage figé", () => {
    // 17:00 UTC = 19:00 à Paris en août (UTC+2) mais 18:00 en janvier (UTC+1).
    expect(localHM(new Date("2026-08-10T17:00:00Z"), "Europe/Paris", 0).hour).toBe(19);
    expect(localHM(new Date("2026-01-10T17:00:00Z"), "Europe/Paris", 0).hour).toBe(18);
  });

  it("donne la date locale, y compris quand elle diffère de la date UTC", () => {
    // 23:30 UTC = 08:30 le LENDEMAIN à Tokyo.
    expect(localHM(new Date("2026-08-10T23:30:00Z"), "Asia/Tokyo", 0)).toEqual({
      hour: 8,
      date: "2026-08-11",
    });
  });

  it("rend 0 (et non 24) à minuit local", () => {
    expect(localHM(new Date("2026-08-10T22:00:00Z"), "Europe/Paris", 0).hour).toBe(0);
  });

  it("se rabat sur le décalage figé si le fuseau est inconnu du runtime", () => {
    // -120 = UTC+2 (getTimezoneOffset est positif à l'ouest de Greenwich).
    expect(localHM(new Date("2026-08-10T17:00:00Z"), "Mars/Olympus", -120)).toEqual({
      hour: 19,
      date: "2026-08-10",
    });
  });
});

describe("shouldSendNow", () => {
  const at19 = new Date("2026-08-10T17:00:00Z"); // 19:00 à Paris

  it("n'envoie qu'à l'heure locale demandée", () => {
    expect(shouldSendNow(record({ hour: 19 }), at19)).toBe(true);
    expect(shouldSendNow(record({ hour: 20 }), at19)).toBe(false);
  });

  it("se taît quand la journée locale est déjà bouclée", () => {
    expect(shouldSendNow(record({ skipDate: "2026-08-10" }), at19)).toBe(false);
    // Un skipDate d'hier ne doit pas éteindre le rappel d'aujourd'hui.
    expect(shouldSendNow(record({ skipDate: "2026-08-09" }), at19)).toBe(true);
  });

  it("n'envoie qu'un rappel par journée locale, même si le cron repasse", () => {
    const sentToday = new Date("2026-08-10T17:02:00Z").getTime();
    expect(shouldSendNow(record({ lastSentAt: sentToday }), at19)).toBe(false);
    const sentYesterday = new Date("2026-08-09T17:00:00Z").getTime();
    expect(shouldSendNow(record({ lastSentAt: sentYesterday }), at19)).toBe(true);
  });

  it("rattrape une passe manquée, mais pas indéfiniment", () => {
    const at21 = new Date("2026-08-10T19:00:00Z"); // 21:00 à Paris, deux heures trop tard
    const at22 = new Date("2026-08-10T20:00:00Z"); // 22:00 : hors fenêtre de rattrapage
    expect(shouldSendNow(record({ hour: 19 }), at21)).toBe(true);
    expect(shouldSendNow(record({ hour: 19 }), at22)).toBe(false);
    // Rattraper n'est pas devancer : avant l'heure, rien ne part.
    expect(shouldSendNow(record({ hour: 21 }), at19)).toBe(false);
    // Et le rattrapage reste soumis aux mêmes gardes que l'envoi à l'heure.
    expect(shouldSendNow(record({ hour: 19, skipDate: "2026-08-10" }), at21)).toBe(false);
    const sentAt19 = new Date("2026-08-10T17:00:00Z").getTime();
    expect(shouldSendNow(record({ hour: 19, lastSentAt: sentAt19 }), at21)).toBe(false);
  });

  it("ne rattrape pas pour un abonnement créé le jour même", () => {
    // Activer les rappels à 20 h pour 19 h ne doit pas sonner dans la minute.
    const at20 = new Date("2026-08-10T18:00:00Z");
    const createdAt = new Date("2026-08-10T18:00:00Z").getTime();
    expect(shouldSendNow(record({ hour: 19, createdAt }), at20)).toBe(false);
    // Le lendemain, le même abonnement rattrape normalement.
    expect(shouldSendNow(record({ hour: 19, createdAt }), new Date("2026-08-11T18:00:00Z"))).toBe(
      true,
    );
  });
});

describe("parseSubscribe", () => {
  const base = { endpoint: ENDPOINT, hour: 19, zone: "Europe/Paris", tzOffsetMinutes: -120 };

  it("accepte un corps valide", () => {
    expect(parseSubscribe(base)).toMatchObject({ endpoint: ENDPOINT, hour: 19 });
  });

  it("refuse ce qui ferait du Worker un relais de requêtes arbitraires", () => {
    expect(parseSubscribe({ ...base, endpoint: "http://fcm.googleapis.com/x" })).toBeNull();
    expect(parseSubscribe({ ...base, endpoint: "https://localhost/x" })).toBeNull();
    expect(parseSubscribe({ ...base, endpoint: "https://box.local/x" })).toBeNull();
    expect(parseSubscribe({ ...base, endpoint: "pas une url" })).toBeNull();
    expect(parseSubscribe(null)).toBeNull();
  });

  it("refuse une heure ou une date hors format", () => {
    expect(parseSubscribe({ ...base, hour: 24 })).toBeNull();
    expect(parseSubscribe({ ...base, hour: -1 })).toBeNull();
    expect(parseSubscribe({ ...base, hour: 9.5 })).toBeNull();
    expect(parseSubscribe({ ...base, skipDate: "10/08/2026" })).toBeNull();
    // "" est légitime : il demande d'effacer le marqueur.
    expect(parseSubscribe({ ...base, skipDate: "" })).toMatchObject({ skipDate: "" });
  });
});

describe("mergeRecord", () => {
  const input = parseSubscribe({
    endpoint: ENDPOINT,
    hour: 8,
    zone: "Europe/Paris",
    tzOffsetMinutes: -120,
  })!;

  it("préserve createdAt, lastSentAt et le skipDate absent du corps", () => {
    const existing = record({ createdAt: 111, lastSentAt: 222, skipDate: "2026-08-10" });
    const merged = mergeRecord(input, existing, 999);
    expect(merged).toMatchObject({ hour: 8, createdAt: 111, lastSentAt: 222, skipDate: "2026-08-10" });
  });

  it('efface le skipDate sur ""', () => {
    const existing = record({ skipDate: "2026-08-10" });
    expect(mergeRecord({ ...input, skipDate: "" }, existing, 999).skipDate).toBeUndefined();
  });
});

describe("vapidAuth", () => {
  it("produit un JWT ES256 dont la signature est valide", async () => {
    const env = await vapidEnv();
    const now = Date.UTC(2026, 7, 10, 12, 0, 0);
    const header = await vapidAuth(ENDPOINT, env, now);

    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(env.VAPID_PUBLIC_KEY);

    const [h, p, sig] = m![1].split(".");
    expect(JSON.parse(new TextDecoder().decode(b64uToBytes(h)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(new TextDecoder().decode(b64uToBytes(p)));
    // `aud` = ORIGINE de l'endpoint, pas l'URL complète.
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:moi@example.test");
    // Apple rejette au-delà de 24 h.
    expect(claims.exp - now / 1000).toBeGreaterThan(0);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);

    // `crypto.subtle.sign` renvoie r||s brut (64 o) : c'est déjà le format JWS.
    const raw = b64uToBytes(sig);
    expect(raw.length).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      env.verifyKey,
      raw,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});

describe("isGone", () => {
  it("ne considère morts que 404 et 410", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    expect(isGone(429)).toBe(false);
    expect(isGone(500)).toBe(false);
    expect(isGone(201)).toBe(false);
  });
});

describe("runPushCron", () => {
  let env: PushEnvLike;
  const at19 = new Date("2026-08-10T17:00:00Z");

  beforeEach(async () => {
    env = await vapidEnv();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seed(bucket: R2Bucket, rec: PushRecord) {
    await bucket.put(await pushKey(rec.endpoint), JSON.stringify(rec));
  }

  it("envoie un push VIDE (sans corps) et marque lastSentAt", async () => {
    const bucket = mockBucket();
    await seed(bucket, record());
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await runPushCron(bucket, env, at19)).toEqual({ sent: 1, removed: 0, skipped: 0 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^vapid t=/);
    expect((init.headers as Record<string, string>).TTL).toBe("3600");

    const stored = JSON.parse([...bucket.store.values()][0]) as PushRecord;
    expect(stored.lastSentAt).toBe(at19.getTime());
  });

  it("supprime un abonnement mort (410) et garde un transitoire (429)", async () => {
    const bucket = mockBucket();
    await seed(bucket, record());
    vi.stubGlobal("fetch", async () => new Response(null, { status: 410 }));
    expect(await runPushCron(bucket, env, at19)).toEqual({ sent: 0, removed: 1, skipped: 0 });
    expect(bucket.store.size).toBe(0);

    await seed(bucket, record());
    vi.stubGlobal("fetch", async () => new Response(null, { status: 429 }));
    expect(await runPushCron(bucket, env, at19)).toEqual({ sent: 0, removed: 0, skipped: 1 });
    // Rien marqué → la passe suivante réessaiera.
    expect((JSON.parse([...bucket.store.values()][0]) as PushRecord).lastSentAt).toBeUndefined();
  });

  it("ne touche à rien quand ce n'est pas l'heure ou la journée est bouclée", async () => {
    const bucket = mockBucket();
    await seed(bucket, record({ hour: 7 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runPushCron(bucket, env, at19)).toEqual({ sent: 0, removed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("est inerte sans secrets VAPID (fork non configuré)", async () => {
    const bucket = mockBucket();
    await seed(bucket, record());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runPushCron(bucket, {}, at19)).toEqual({ sent: 0, removed: 0, skipped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handlePushSubscribe", () => {
  it("répond 503 sans secrets, 400 sur corps invalide, et écrit sinon", async () => {
    const bucket = mockBucket();
    const env = await vapidEnv();
    const post = (body: unknown) =>
      new Request("https://worker.test/push/subscribe", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const valid = { endpoint: ENDPOINT, hour: 19, zone: "Europe/Paris", tzOffsetMinutes: -120 };

    expect((await handlePushSubscribe(post(valid), bucket, {}, json)).status).toBe(503);
    expect((await handlePushSubscribe(post({ endpoint: "nope" }), bucket, env, json)).status).toBe(400);

    const res = await handlePushSubscribe(post(valid), bucket, env, json);
    expect(res.status).toBe(200);
    // Clé = hash de l'endpoint : un listing du bucket ne révèle rien d'utilisable.
    expect([...bucket.store.keys()]).toEqual([await pushKey(ENDPOINT)]);
    expect(JSON.parse([...bucket.store.values()][0])).toMatchObject({ hour: 19 });
  });
});
