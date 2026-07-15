// Stockage persistant : sans `navigator.storage.persist()`, IndexedDB est en mode
// « best-effort » — sous pression de stockage, le navigateur peut purger TOUTES les
// données locales (audio téléchargé, SRS, histoires), précisément dans le scénario
// hors-ligne où on en a besoin. Demandé une fois au démarrage (App.tsx) ; l'état et
// l'usage sont affichés dans les réglages (section Stockage).

export interface StorageInfo {
  /** Persistance accordée : le navigateur ne purgera pas les données sans action de l'utilisateur. */
  persisted: boolean;
  /** Octets utilisés, si le navigateur les rapporte. */
  usage?: number;
  /** Quota total en octets, si le navigateur le rapporte. */
  quota?: number;
}

/** API navigator.storage, absente de certains navigateurs (et de l'environnement de test). */
function storageManager(): StorageManager | undefined {
  return typeof navigator !== "undefined" ? navigator.storage : undefined;
}

/**
 * Demande la persistance du stockage. `true` si accordée (immédiatement ou déjà acquise),
 * `false` sinon — API absente et rejets compris : un échec de confort ne doit jamais
 * casser le démarrage.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = storageManager();
  if (!storage?.persist) return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}

/** État courant du stockage (persistance + usage/quota), tolérant aux API absentes. */
export async function getStorageInfo(): Promise<StorageInfo> {
  const storage = storageManager();
  let persisted = false;
  try {
    persisted = (await storage?.persisted?.()) ?? false;
  } catch {
    persisted = false;
  }
  try {
    const est = await storage?.estimate?.();
    return { persisted, usage: est?.usage, quota: est?.quota };
  } catch {
    return { persisted };
  }
}

/** Formate des octets pour l'affichage (fr) : « 12 Mo », « 1,2 Go ». */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6).toLocaleString("fr-FR")} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3)).toLocaleString("fr-FR")} ko`;
}
