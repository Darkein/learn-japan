// Synchronisation de l'avancement entre appareils (SPEC « Phase 4 » de db.ts) — façon
// sauvegarde cloud de jeu mobile : un CODE DE SESSION court (recopiable à la main) identifie
// la sauvegarde, stockée sur R2 via le Worker (voir worker/src/progress.ts). Pas de compte,
// pas de BDD. Le code est le secret : il ne voyage que dans l'en-tête Authorization.
//
// Stratégie : last-write-wins sur le snapshot ENTIER, avec deux garde-fous —
//  - au push, le Worker répond 409 si le distant a avancé depuis notre dernière base ;
//  - au lancement, fast-forward silencieux si le local n'a pas changé et le distant est
//    plus récent (c'est CE chemin qui propage les données vers un second appareil).
//
// Le snapshot embarque le progrès (SRS, leçons, histoires, stats, réglages) mais AUCUN
// blob régénérable (images, TTS, dict, cours générés) : les images reviennent d'elles-mêmes
// via le backfill, le reste se re-télécharge du cache R2 de contenu.

import { DB_VERSION, getDB, getMeta, putMeta } from "./db";
import type { Card } from "ts-fsrs";
import type {
  ComprehensionItem,
  EncounterRecord,
  GrammarItem,
  LessonProgressRecord,
  MetaRecord,
  OmikujiRecord,
  ReviewLog,
  SrsDailyRecord,
  StoryRecord,
  VocabItem,
} from "./db";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { WORKER_URL } from "./config";

// ---- Code de session ---------------------------------------------------------

/** Base32 sans caractères ambigus (pas de I, O, 0, 1) — 32 symboles pile. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/;

/** Génère un code de session : 12 symboles (~60 bits), groupés par 4. */
export function generateSyncCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  // 256 / 32 = 8 : le modulo est parfaitement équiréparti.
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % 32]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** Normalise une saisie utilisateur (espaces, casse, tirets), ou null si invalide. */
export function normalizeSyncCode(input: string): string | null {
  const bare = input.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (bare.length !== 12) return null;
  const code = `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8)}`;
  return CODE_RE.test(code) ? code : null;
}

// ---- Snapshot ----------------------------------------------------------------

/** Nombre max de lignes du journal de révisions embarquées (le local garde tout). */
const REVIEWS_CAP = 20_000;

/** Clés meta locales à l'appareil, JAMAIS synchronisées. */
const LOCAL_META = /^(sync:|storyImageTried:)/;

export interface SyncSnapshot {
  formatVersion: 1;
  /** Version du schéma IndexedDB à l'export — refus d'importer plus récent que le local. */
  dbVersion: number;
  exportedAt: number;
  stores: {
    vocab: VocabItem[];
    grammar: GrammarItem[];
    comprehension: ComprehensionItem[];
    reviews: ReviewLog[];
    lessonProgress: LessonProgressRecord[];
    srsDaily: SrsDailyRecord[];
    encounters: EncounterRecord[];
    omikuji: OmikujiRecord[];
    meta: MetaRecord[];
    stories: StoryRecord[];
  };
  settings: AppSettings;
}

type SyncStoreName = keyof SyncSnapshot["stores"];
const SYNC_STORES: SyncStoreName[] = [
  "vocab", "grammar", "comprehension", "reviews", "lessonProgress",
  "srsDaily", "encounters", "omikuji", "meta", "stories",
];

/** Sérialise tout le progrès local. Ne touche à aucun store de cache/blob. */
export async function exportSnapshot(): Promise<SyncSnapshot> {
  const db = await getDB();
  const [vocab, grammar, comprehension, reviews, lessonProgress, srsDaily, encounters, omikuji, meta, stories] =
    await Promise.all([
      db.getAll("vocab"), db.getAll("grammar"), db.getAll("comprehension"),
      db.getAll("reviews"), db.getAll("lessonProgress"), db.getAll("srsDaily"),
      db.getAll("encounters"), db.getAll("omikuji"), db.getAll("meta"), db.getAll("stories"),
    ]);
  return {
    formatVersion: 1,
    dbVersion: DB_VERSION,
    exportedAt: Date.now(),
    stores: {
      vocab, grammar, comprehension,
      // Journal borné : le seul store à croissance illimitée. Trier serait inutile,
      // l'autoIncrement garantit l'ordre chronologique — on garde la fin.
      reviews: reviews.slice(-REVIEWS_CAP),
      lessonProgress, srsDaily, encounters, omikuji,
      meta: meta.filter((m) => !LOCAL_META.test(m.key)),
      stories,
    },
    settings: loadSettings(),
  };
}

/** Empreinte du CONTENU (stores + réglages) — exclut exportedAt pour rester stable. */
export async function snapshotHash(s: SyncSnapshot): Promise<string> {
  const material = JSON.stringify({ stores: s.stores, settings: s.settings });
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- gzip --------------------------------------------------------------------

export async function gzipJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([JSON.stringify(value)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipJson<T>(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<T> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return (await new Response(stream).json()) as T;
}

// ---- Import ------------------------------------------------------------------

/** JSON a aplati les Date FSRS en chaînes ISO : réhydratation obligatoire (isDue fait .getTime()). */
function reviveCard(c: Card | undefined): Card | undefined {
  if (!c) return undefined;
  return {
    ...c,
    due: new Date(c.due),
    ...(c.last_review ? { last_review: new Date(c.last_review) } : {}),
  };
}

/**
 * Remplace TOUT le progrès local par le snapshot. Une seule transaction multi-store :
 * fermeture en plein import → transaction annulée, données locales intactes. Les clés meta
 * locales (sync:*) de CET appareil sont préservées. Appeler `location.reload()` après.
 */
export async function importSnapshot(s: SyncSnapshot): Promise<void> {
  if (s.formatVersion !== 1) throw new Error("Format de sauvegarde inconnu — mets à jour l'app.");
  if (s.dbVersion > DB_VERSION) throw new Error("Sauvegarde plus récente que l'app — mets à jour l'app.");

  // Réhydratation AVANT la transaction (une tx idb auto-commit si on await hors d'elle).
  const vocab = s.stores.vocab.map((v) => ({
    ...v,
    cards: Object.fromEntries(
      Object.entries(v.cards).map(([k, c]) => [k, reviveCard(c as Card)]),
    ) as VocabItem["cards"],
  }));
  const grammar = s.stores.grammar.map((g) => ({ ...g, card: reviveCard(g.card) }));
  const comprehension = s.stores.comprehension.map((c) => ({ ...c, card: reviveCard(c.card) }));

  const db = await getDB();
  const localMeta = (await db.getAll("meta")).filter((m) => LOCAL_META.test(m.key));

  const tx = db.transaction(SYNC_STORES, "readwrite");
  const ops: Promise<unknown>[] = [];
  const replace = <N extends SyncStoreName>(name: N, rows: SyncSnapshot["stores"][N]) => {
    const store = tx.objectStore(name);
    ops.push(store.clear());
    for (const row of rows) ops.push(store.put(row as never));
  };
  replace("vocab", vocab);
  replace("grammar", grammar);
  replace("comprehension", comprehension);
  replace("reviews", s.stores.reviews);
  replace("lessonProgress", s.stores.lessonProgress);
  replace("srsDaily", s.stores.srsDaily);
  replace("encounters", s.stores.encounters);
  replace("omikuji", s.stores.omikuji);
  replace("meta", s.stores.meta.filter((m) => !LOCAL_META.test(m.key)));
  replace("stories", s.stores.stories);
  for (const m of localMeta) ops.push(tx.objectStore("meta").put(m));
  await Promise.all(ops);
  await tx.done;

  // Hors transaction : localStorage n'y participe pas. Un crash ici laisse des réglages
  // périmés mais un progrès cohérent — acceptable.
  saveSettings(s.settings);
}

// ---- Transport ---------------------------------------------------------------

const META_CODE = "sync:code";
const META_LAST_SYNC = "sync:lastSyncAt";
const META_LAST_HASH = "sync:lastPushHash";
const META_REMOTE_AT = "sync:remoteUpdatedAt";

export async function getSyncCode(): Promise<string | null> {
  return (await getMeta<string>(META_CODE)) ?? null;
}
export async function getLastSyncAt(): Promise<number | null> {
  return (await getMeta<number>(META_LAST_SYNC)) ?? null;
}
export async function setSyncCode(code: string): Promise<void> {
  await putMeta(META_CODE, code);
}

/** Oublie le code local (ne supprime rien côté R2). */
export async function disconnectSync(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.delete("meta", META_CODE),
    db.delete("meta", META_LAST_SYNC),
    db.delete("meta", META_LAST_HASH),
    db.delete("meta", META_REMOTE_AT),
  ]);
}

/** Mémorise l'état « synchronisé » après un push/pull réussi. */
async function recordSynced(remoteUpdatedAt: number, hash: string): Promise<void> {
  await Promise.all([
    putMeta(META_LAST_SYNC, Date.now()),
    putMeta(META_LAST_HASH, hash),
    putMeta(META_REMOTE_AT, remoteUpdatedAt),
  ]);
}

export type PushResult = "pushed" | "skipped" | "conflict" | "no_code" | "offline" | "error";

/**
 * Pousse le progrès local. `skipped` si rien n'a changé depuis le dernier sync (empreinte
 * identique). `conflict` = le distant a avancé ET le local aussi (divergence réelle) —
 * l'appelant choisit entre `force` (écraser) et `pullProgress()` (récupérer).
 */
export async function pushProgress(opts: { force?: boolean } = {}): Promise<PushResult> {
  const code = await getSyncCode();
  if (!code) return "no_code";

  const snapshot = await exportSnapshot();
  const hash = await snapshotHash(snapshot);
  if (!opts.force && hash === (await getMeta<string>(META_LAST_HASH))) return "skipped";

  const body = await gzipJson(snapshot);
  const base = (await getMeta<number>(META_REMOTE_AT)) ?? 0;
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/progress/push`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/octet-stream",
        "X-Base-Updated-At": String(base),
        ...(opts.force ? { "X-Force": "1" } : {}),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return "offline";
  }
  if (res.status === 409) return "conflict";
  if (!res.ok) return "error";
  const { updatedAt } = (await res.json()) as { updatedAt: number };
  await recordSynced(updatedAt, hash);
  return "pushed";
}

export type PullResult = "replaced" | "not_found" | "no_code" | "offline" | "error";

/**
 * Récupère et INSTALLE la sauvegarde distante (le local est remplacé).
 * L'appelant DOIT `location.reload()` sur `replaced` (état React périmé partout).
 */
export async function pullProgress(): Promise<PullResult> {
  const code = await getSyncCode();
  if (!code) return "no_code";

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/progress/pull`, {
      method: "POST",
      headers: { Authorization: `Bearer ${code}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return "offline";
  }
  if (res.status === 404) return "not_found";
  if (!res.ok) return "error";

  const remoteUpdatedAt = parseInt(res.headers.get("X-Updated-At") ?? "0", 10) || Date.now();
  try {
    const snapshot = await gunzipJson<SyncSnapshot>(await res.arrayBuffer());
    await importSnapshot(snapshot);
    // Empreinte recalculée depuis la base FRAÎCHE (l'ordre des clés peut différer du
    // snapshot reçu) → le prochain tick voit un état propre et ne re-push pas.
    await recordSynced(remoteUpdatedAt, await snapshotHash(await exportSnapshot()));
  } catch {
    return "error";
  }
  return "replaced";
}

/**
 * Fast-forward au lancement : si le local n'a PAS changé depuis notre dernière base
 * (empreinte identique) et que le distant est plus récent, on l'installe silencieusement.
 * Renvoie true si remplacé (l'appelant recharge la page).
 */
export async function pullOnLaunch(): Promise<boolean> {
  const code = await getSyncCode();
  if (!code) return false;
  const lastHash = await getMeta<string>(META_LAST_HASH);
  if (!lastHash) return false;
  if ((await snapshotHash(await exportSnapshot())) !== lastHash) return false; // local modifié

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/progress/pull`, {
      method: "POST",
      headers: { Authorization: `Bearer ${code}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const remoteUpdatedAt = parseInt(res.headers.get("X-Updated-At") ?? "0", 10) || 0;
  const base = (await getMeta<number>(META_REMOTE_AT)) ?? 0;
  if (remoteUpdatedAt <= base) return false; // rien de neuf

  try {
    const snapshot = await gunzipJson<SyncSnapshot>(await res.arrayBuffer());
    await importSnapshot(snapshot);
    await recordSynced(remoteUpdatedAt, await snapshotHash(await exportSnapshot()));
  } catch {
    return false;
  }
  return true;
}

// ---- Cadence -----------------------------------------------------------------

const TICK_MS = 60_000;
const SYNC_INTERVAL_MS = 5 * 60_000;
let lastAttemptAt = 0;

/** Push périodique, sous verrou inter-onglets (un seul onglet synchronise à la fois). */
async function syncTick(): Promise<void> {
  const run = () => pushProgress().then(() => void putMeta("sync:lastAttemptAt", Date.now()));
  if (navigator.locks?.request) {
    await navigator.locks.request("lj-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  } else {
    await run();
  }
}

/**
 * Démarre la synchronisation : fast-forward au lancement (reload si remplacé), tick
 * périodique (≥ 5 min entre deux tentatives, onglet visible), push best-effort au passage
 * en arrière-plan. Renvoie la fonction d'arrêt. No-op tant qu'aucun code n'est configuré.
 */
export function initSync(): () => void {
  void pullOnLaunch().then((replaced) => {
    if (replaced) location.reload();
  });

  const interval = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastAttemptAt < SYNC_INTERVAL_MS) return;
    lastAttemptAt = Date.now();
    void syncTick();
  }, TICK_MS);

  // Passage en arrière-plan : dernière chance de pousser (fetch normal — sendBeacon
  // plafonne à ~64 Ko ; sur mobile la requête peut être tuée, le tick compensera).
  const onHidden = () => {
    if (document.visibilityState === "hidden") void syncTick();
  };
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onHidden);
  };
}
