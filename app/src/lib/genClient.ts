// Client de génération : poste une requête ciblée au Worker, qui répond directement.
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

interface GenerateResponse {
  text?: string;
  error?: string;
}

/**
 * Génère un texte : un seul aller-retour synchrone vers le Worker.
 * `onState` permet d'afficher la progression côté UI.
 */
export async function generateText(
  params: GenParams,
  onState?: (s: GenState) => void,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  onState?.("generating");

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "story", ...params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    onState?.("error");
    throw new Error(`Worker injoignable : ${String(e)}`);
  }

  const data = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok || data.error) {
    onState?.("error");
    throw new Error(data.error ?? `generate HTTP ${res.status}`);
  }
  if (!data.text) {
    onState?.("error");
    throw new Error("Réponse vide du Worker");
  }

  onState?.("ready");
  return data.text;
}
