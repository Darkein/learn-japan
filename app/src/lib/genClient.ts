// Client de génération : poste une requête ciblée au Worker puis poll le statut.
// Le Worker (et lui seul) appelle Gemini avec la clé secrète → rien à voler côté client.

import { WORKER_URL } from "./config";

export interface GenParams {
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  prompt?: string;
  level?: number;
}

export type GenState = "queued" | "generating" | "ready" | "error" | "unknown";

interface StatusReady {
  state: "ready";
  text: string;
}
interface StatusError {
  state: "error";
  message: string;
}
type StatusResponse =
  | { state: "queued" | "generating" | "unknown" }
  | StatusReady
  | StatusError;

/** Lance une génération ; renvoie l'id de requête à suivre. */
export async function requestGeneration(params: GenParams): Promise<string> {
  const res = await fetch(`${WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "story", ...params }),
  });
  if (!res.ok) throw new Error(`generate HTTP ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Lit le statut courant d'une requête. */
export async function getStatus(id: string): Promise<StatusResponse> {
  const res = await fetch(`${WORKER_URL}/status/${id}`);
  if (!res.ok) throw new Error(`status HTTP ${res.status}`);
  return (await res.json()) as StatusResponse;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Génère un texte de bout en bout : requête + polling jusqu'à `ready`/`error`.
 * `onState` permet d'afficher la progression côté UI.
 */
export async function generateText(
  params: GenParams,
  onState?: (s: GenState) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const intervalMs = opts.intervalMs ?? 1200;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  const id = await requestGeneration(params);
  onState?.("queued");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const status = await getStatus(id);
    onState?.(status.state);
    if (status.state === "ready") return (status as StatusReady).text;
    if (status.state === "error") throw new Error((status as StatusError).message);
  }
  throw new Error("Délai de génération dépassé");
}
