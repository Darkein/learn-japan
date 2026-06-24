// Configuration runtime. L'URL du Worker de génération est surchargeable via
// VITE_WORKER_URL (build) ; défaut = Worker déployé. Aucune clé ici : le client
// ne parle qu'au Worker, qui détient seul la clé Gemini.

const FALLBACK_WORKER_URL = "https://learn-japan-gen.learn-japan-gen.workers.dev";

export const WORKER_URL = (
  import.meta.env.VITE_WORKER_URL ?? FALLBACK_WORKER_URL
).replace(/\/+$/, "");
