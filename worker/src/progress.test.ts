// Sync d'avancement : validation du code bearer, garde LWW (409/force), cap de taille,
// rotation de la génération de secours (.prev). Bucket R2 mocké en mémoire.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "./index";
import { progressKey } from "./progress";

const CODE = "K7MP-X2R9-4TQF";

interface StoredObj {
  bytes: Uint8Array;
  customMetadata?: Record<string, string>;
  uploaded: Date;
}

/** Mock R2 minimal : get/head/put sur un Map, corps streams/bytes confondus. */
function mockBucket() {
  const store = new Map<string, StoredObj>();
  const toObj = (key: string) => {
    const o = store.get(key);
    if (!o) return null;
    return {
      key,
      body: new Blob([o.bytes]).stream(),
      customMetadata: o.customMetadata,
      uploaded: o.uploaded,
    };
  };
  return {
    store,
    async get(key: string) {
      return toObj(key);
    },
    async head(key: string) {
      const o = store.get(key);
      return o ? { key, customMetadata: o.customMetadata, uploaded: o.uploaded } : null;
    },
    async put(
      key: string,
      value: ReadableStream | Uint8Array | ArrayBuffer,
      opts?: { customMetadata?: Record<string, string> },
    ) {
      let bytes: Uint8Array;
      if (value instanceof ReadableStream) {
        bytes = new Uint8Array(await new Response(value).arrayBuffer());
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else {
        bytes = value;
      }
      store.set(key, { bytes, customMetadata: opts?.customMetadata, uploaded: new Date() });
    },
  } as unknown as R2Bucket & { store: Map<string, StoredObj> };
}

function pushReq(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request("https://worker.test/progress/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CODE}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.byteLength),
      ...headers,
    },
    body,
  });
}

function pullReq(code = CODE) {
  return new Request("https://worker.test/progress/pull", {
    method: "POST",
    headers: { Authorization: `Bearer ${code}` },
  });
}

let bucket: ReturnType<typeof mockBucket>;
let env: never;

beforeEach(() => {
  bucket = mockBucket();
  env = { REQUIRE_ACCESS: "false", PROGRESS: bucket } as never;
});

describe("/progress", () => {
  it("503 sans binding PROGRESS", async () => {
    const res = await worker.fetch(pullReq(), { REQUIRE_ACCESS: "false" } as never);
    expect(res.status).toBe(503);
  });

  it("400 sur code malformé (et jamais de clé écrite)", async () => {
    const res = await worker.fetch(pullReq("abc"), env);
    expect(res.status).toBe(400);
    expect(bucket.store.size).toBe(0);
  });

  it("404 au pull d'un code inconnu", async () => {
    const res = await worker.fetch(pullReq(), env);
    expect(res.status).toBe(404);
  });

  it("roundtrip push → pull : mêmes bytes, X-Updated-At cohérent, clé = hash du code", async () => {
    const payload = new TextEncoder().encode("gzip-blob");
    const push = await worker.fetch(pushReq(payload), env);
    expect(push.status).toBe(200);
    const { updatedAt } = (await push.json()) as { updatedAt: number };
    expect(updatedAt).toBeGreaterThan(0);

    const key = await progressKey(CODE);
    expect(key).toMatch(/^progress\/[0-9a-f]{64}\.bin$/);
    expect(bucket.store.has(key)).toBe(true);

    const pull = await worker.fetch(pullReq(), env);
    expect(pull.status).toBe(200);
    expect(pull.headers.get("X-Updated-At")).toBe(String(updatedAt));
    expect(pull.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await pull.arrayBuffer())).toEqual(payload);
  });

  it("409 si le distant a avancé, passe avec X-Force", async () => {
    const first = await worker.fetch(pushReq(new Uint8Array([1])), env);
    const { updatedAt } = (await first.json()) as { updatedAt: number };

    // Base périmée (0) → conflit.
    const conflict = await worker.fetch(pushReq(new Uint8Array([2]), { "X-Base-Updated-At": "0" }), env);
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { remoteUpdatedAt: number }).remoteUpdatedAt).toBe(updatedAt);

    // Base à jour → OK.
    const ok = await worker.fetch(
      pushReq(new Uint8Array([3]), { "X-Base-Updated-At": String(updatedAt) }),
      env,
    );
    expect(ok.status).toBe(200);

    // Base périmée mais force → OK.
    const forced = await worker.fetch(
      pushReq(new Uint8Array([4]), { "X-Base-Updated-At": "0", "X-Force": "1" }),
      env,
    );
    expect(forced.status).toBe(200);
  });

  it("413 au-delà du cap de taille", async () => {
    const res = await worker.fetch(
      pushReq(new Uint8Array([1]), { "Content-Length": String(5 * 1024 * 1024) }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it("copie la sauvegarde courante en .prev avant écrasement", async () => {
    const v1 = new TextEncoder().encode("version-1");
    const first = await worker.fetch(pushReq(v1), env);
    const { updatedAt } = (await first.json()) as { updatedAt: number };

    const v2 = new TextEncoder().encode("version-2");
    await worker.fetch(pushReq(v2, { "X-Base-Updated-At": String(updatedAt) }), env);

    const prev = bucket.store.get(await progressKey(CODE, true));
    expect(prev).toBeDefined();
    expect(new TextDecoder().decode(prev!.bytes)).toBe("version-1");
    const current = bucket.store.get(await progressKey(CODE));
    expect(new TextDecoder().decode(current!.bytes)).toBe("version-2");
  });
});
