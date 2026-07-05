// Comptage des cartes dues, PARTAGÉ entre l'app et le service worker (rappels).
// Le SW n'embarque pas ts-fsrs : une carte FSRS stockée via structured clone garde son
// `due: Date`, la comparaison directe suffit. La logique (horizon +15 min compris) est
// alignée sur sessionStats (lib/reviewSession.ts).

/** Sous-ensemble d'une carte FSRS nécessaire au comptage. */
export interface DueCardLike {
  due: Date;
}
export interface DueVocabLike {
  cards: Partial<Record<string, DueCardLike>>;
}
export interface DueSingleCardLike {
  card?: DueCardLike;
}

/** +15 min : inclut les cartes dues imminentes (step relearning FSRS = 10 min). */
const HORIZON_MS = 15 * 60 * 1000;

/** Nombre de cartes dues (pur, testable, sans ts-fsrs). */
export function countDueItems(
  vocab: DueVocabLike[],
  grammar: DueSingleCardLike[],
  comprehension: DueSingleCardLike[],
  now: Date = new Date(),
): number {
  const horizon = now.getTime() + HORIZON_MS;
  const isDue = (c: DueCardLike | undefined) => !!c && c.due.getTime() <= horizon;
  let due = 0;
  for (const v of vocab) {
    for (const card of Object.values(v.cards)) if (isDue(card)) due++;
  }
  for (const g of grammar) if (isDue(g.card)) due++;
  for (const c of comprehension) if (isDue(c.card)) due++;
  return due;
}

/**
 * Comptage depuis IndexedDB « brute » (API native, sans le schéma typé de db.ts) —
 * utilisable dans le service worker. Renvoie 0 si la base n'existe pas encore.
 */
export async function countDueFromIndexedDB(now: Date = new Date()): Promise<number> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    // Pas de version : on ouvre la base telle quelle (le SW ne doit jamais la migrer).
    const req = indexedDB.open("learn-japan");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db) return 0;
  try {
    const stores = ["vocab", "grammar", "comprehension"].filter((s) =>
      db.objectStoreNames.contains(s),
    );
    if (stores.length === 0) return 0;
    const tx = db.transaction(stores, "readonly");
    const readAll = (store: string): Promise<unknown[]> =>
      new Promise((resolve, reject) => {
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result as unknown[]);
        req.onerror = () => reject(req.error);
      });
    const [vocab, grammar, comprehension] = await Promise.all(
      ["vocab", "grammar", "comprehension"].map((s) =>
        stores.includes(s) ? readAll(s) : Promise.resolve([]),
      ),
    );
    return countDueItems(
      vocab as DueVocabLike[],
      grammar as DueSingleCardLike[],
      comprehension as DueSingleCardLike[],
      now,
    );
  } finally {
    db.close();
  }
}

/** Lit une entrée du store `meta` en IndexedDB brute (pour le SW). */
export async function readMetaRaw<T>(key: string): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open("learn-japan");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db) return undefined;
  try {
    if (!db.objectStoreNames.contains("meta")) return undefined;
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction("meta", "readonly").objectStore("meta").get(key);
      req.onsuccess = () => resolve((req.result as { value: T } | undefined)?.value);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Écrit une entrée du store `meta` en IndexedDB brute (pour le SW). */
export async function writeMetaRaw(key: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open("learn-japan");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains("meta")) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
