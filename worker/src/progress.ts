// Sauvegarde de l'avancement utilisateur (sync multi-appareils) — R2 seul, pas de BDD.
//
// Le CODE DE SESSION est le secret (bearer, ~60 bits) : il voyage exclusivement dans
// l'en-tête Authorization (jamais en URL → jamais dans les logs). La clé R2 est le
// SHA-256 du code : même un listing accidentel du bucket ne révèle aucun code utilisable,
// et aucun endpoint ne liste le préfixe progress/.
//
// Le worker ne PARSE jamais la sauvegarde : blob gzip opaque, relayé en streaming
// (`put(key, req.body)` — jamais bufferisé en mémoire). `updatedAt` vit dans les
// customMetadata R2 (horloge serveur unique) et porte le garde-fou last-write-wins.
//
// Anti-abus (« pas un espace de stockage perso ») : contenu borné à MAX_BYTES par objet,
// deux objets par code (courant + génération précédente), toujours écrasés — impossible
// d'accumuler. Le TOCTOU entre head() et put() est accepté (usage mono-utilisateur).

import { sha256Hex } from "./cache";

/** Format du code : 3 groupes de 4, base32 sans caractères ambigus (pas de I/L/O/0/1). */
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/;

/** Taille max du snapshot COMPRESSÉ (gzip). Large : un snapshot réel fait ~0,5-1 Mo. */
const MAX_BYTES = 4 * 1024 * 1024;

/** Code de session depuis `Authorization: Bearer <code>`, ou null si absent/malformé. */
export function bearerCode(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") ?? "");
  const code = m?.[1].trim().toUpperCase() ?? "";
  return CODE_RE.test(code) ? code : null;
}

/** Clé R2 de la sauvegarde courante d'un code (et de sa génération précédente). */
export async function progressKey(code: string, prev = false): Promise<string> {
  return `progress/${await sha256Hex(code)}${prev ? ".prev" : ""}.bin`;
}

function updatedAtOf(obj: R2Object | null): number | null {
  const raw = obj?.customMetadata?.updatedAt;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

type JsonFn = (body: unknown, status?: number, headers?: Record<string, string>) => Response;

/**
 * POST /progress/pull → le blob gzip courant, streamé depuis R2.
 * `X-Updated-At` porte l'horodatage serveur du dernier push (garde LWW côté client).
 */
export async function handleProgressPull(
  req: Request,
  bucket: R2Bucket | undefined,
  json: JsonFn,
  cors: Record<string, string>,
): Promise<Response> {
  if (!bucket) return json({ error: "sync_unconfigured" }, 503);
  const code = bearerCode(req);
  if (!code) return json({ error: "bad_code" }, 400);

  const obj = await bucket.get(await progressKey(code));
  if (!obj) return json({ error: "not_found" }, 404);

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Updated-At": String(updatedAtOf(obj) ?? obj.uploaded.getTime()),
      ...cors,
    },
  });
}

/**
 * POST /progress/push → écrit le blob gzip du corps ; renvoie { updatedAt } (horloge
 * serveur). 409 si le distant a avancé depuis `X-Base-Updated-At` (sauf `X-Force: 1`).
 * L'objet courant est copié en `.prev.bin` avant écrasement (une génération de secours).
 */
export async function handleProgressPush(
  req: Request,
  bucket: R2Bucket | undefined,
  json: JsonFn,
): Promise<Response> {
  if (!bucket) return json({ error: "sync_unconfigured" }, 503);
  const code = bearerCode(req);
  if (!code) return json({ error: "bad_code" }, 400);

  const length = parseInt(req.headers.get("Content-Length") ?? "", 10);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BYTES) {
    return json({ error: "too_large" }, 413);
  }

  const key = await progressKey(code);
  const existing = await bucket.head(key);
  const remoteUpdatedAt = updatedAtOf(existing) ?? existing?.uploaded.getTime() ?? null;

  const base = parseInt(req.headers.get("X-Base-Updated-At") ?? "0", 10) || 0;
  const force = req.headers.get("X-Force") === "1";
  if (remoteUpdatedAt !== null && remoteUpdatedAt > base && !force) {
    return json({ error: "conflict", remoteUpdatedAt }, 409);
  }

  // Génération de secours : la sauvegarde est la seule donnée NON régénérable du système,
  // un push destructeur (force sur un profil vierge) doit rester rattrapable.
  if (existing) {
    const current = await bucket.get(key);
    if (current) {
      await bucket.put(await progressKey(code, true), current.body, {
        customMetadata: current.customMetadata,
        httpMetadata: { contentType: "application/octet-stream" },
      });
    }
  }

  const updatedAt = Date.now();
  // R2 exige une taille connue pour un stream : FixedLengthStream borne au Content-Length
  // annoncé — un corps plus long fait échouer le put (cap garanti par R2, rien en mémoire).
  // Absent hors runtime Workers (tests Node) → corps passé tel quel.
  const bounded =
    typeof FixedLengthStream !== "undefined"
      ? req.body!.pipeThrough(new FixedLengthStream(length))
      : req.body!;
  await bucket.put(key, bounded, {
    customMetadata: { updatedAt: String(updatedAt) },
    httpMetadata: { contentType: "application/octet-stream" },
  });

  return json({ updatedAt });
}
