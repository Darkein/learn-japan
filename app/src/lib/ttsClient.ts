// Client TTS : synthèse d'une phrase via le Worker (Cloud TTS), avec cache local.
// Le Worker (et lui seul) détient la clé Google → rien à voler côté client. L'audio
// et les timepoints sont mis en cache dans IndexedDB (par phrase) : une phrase déjà
// écoutée n'est jamais re-synthétisée (quota) et reste disponible hors-ligne.

import { TTS_VOICES, WORKER_URL, type TtsLang } from "./config";
import { getTtsCache, putTtsCache } from "./db";

/** Erreur dédiée : le Worker n'a pas de clé TTS → l'appelant bascule sur Web Speech. */
export class TtsUnconfiguredError extends Error {
  constructor() {
    super("tts_unconfigured");
    this.name = "TtsUnconfiguredError";
  }
}

/**
 * Erreur dédiée : le Worker est injoignable (hors-ligne, timeout, DNS). Distincte d'une
 * erreur applicative : hors-ligne, on ne peut pas obtenir le 503 « non configuré », donc
 * l'appelant traite ce cas comme lui — repli sur la Web Speech API (qui marche sans réseau)
 * plutôt qu'une impasse d'erreur.
 */
export class TtsUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`Worker injoignable (TTS) : ${String(cause)}`);
    this.name = "TtsUnreachableError";
  }
}

export interface SentenceAudio {
  audio: Blob;
  /** Timepoints par token : i = index (global) du token, t = secondes dans l'audio. */
  marks: { i: number; t: number }[];
}

const VOICE = TTS_VOICES.ja.voice;
const RATE = 1.0;

/** base64 → Blob MP3 (sans passer par fetch(dataURL), plus rapide et sûr). */
function base64ToBlob(b64: string, type = "audio/mpeg"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

interface TtsResponse {
  audio: Blob;
  marks: { i: number; t: number }[];
}

/**
 * Poste une requête au Worker /tts et renvoie l'audio décodé (+ timepoints éventuels).
 * @throws TtsUnconfiguredError si le Worker n'a pas de clé TTS (HTTP 503).
 */
async function postTts(body: Record<string, unknown>, timeoutMs: number): Promise<TtsResponse> {
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Réseau coupé (TypeError « Failed to fetch ») ou timeout (AbortError) : injoignable.
    throw new TtsUnreachableError(e);
  }

  if (res.status === 503) throw new TtsUnconfiguredError();

  const data = (await res.json().catch(() => ({}))) as {
    audio?: string;
    marks?: { i: number; t: number }[];
    error?: string;
  };
  if (!res.ok || data.error) {
    if (data.error === "tts_unconfigured") throw new TtsUnconfiguredError();
    throw new Error(data.error ?? `tts HTTP ${res.status}`);
  }
  if (!data.audio) throw new Error("Réponse TTS vide");

  return { audio: base64ToBlob(data.audio), marks: data.marks ?? [] };
}

/**
 * Synthétise une phrase (suite de surfaces de tokens) → audio + timepoints.
 * `marks[].i` est ré-indexé sur l'index GLOBAL du premier token via `baseIndex`,
 * pour que le surlignage cible directement la bonne cellule de mot du lecteur.
 *
 * @throws TtsUnconfiguredError si le Worker n'a pas de clé TTS (HTTP 503).
 */
export async function synthesizeSentence(
  segments: string[],
  baseIndex = 0,
  opts: { timeoutMs?: number } = {},
): Promise<SentenceAudio> {
  const text = segments.join("");
  const cacheId = `${VOICE}|${RATE}|${text}`;

  const cached = await getTtsCache(cacheId);
  if (cached) return shift(cached, baseIndex);

  const { audio, marks } = await postTts(
    { segments, voice: VOICE, rate: RATE },
    opts.timeoutMs ?? 30_000,
  );
  await putTtsCache(cacheId, audio, marks); // cache avec index LOCAUX (0-based)
  return shift({ audio, marks }, baseIndex);
}

/** Décale les index de token locaux (0-based dans la phrase) vers l'index global. */
function shift(a: SentenceAudio, baseIndex: number): SentenceAudio {
  if (baseIndex === 0) return a;
  return { audio: a.audio, marks: a.marks.map((m) => ({ i: m.i + baseIndex, t: m.t })) };
}

/** Clé de cache d'un segment podcast (texte entier, voix selon la langue). */
function ttsTextCacheId(text: string, lang: TtsLang): string {
  return `${TTS_VOICES[lang].voice}|${RATE}|${text.trim()}`;
}

/**
 * Synthétise un TEXTE entier (sans timepoints) dans la langue donnée → Blob MP3, mis en
 * cache (mêmes invariants que `synthesizeSentence` : zéro re-synthèse, offline). Sert au
 * mode podcast (cadrage, transitions, quiz, phrases FR) qui n'a pas besoin de surlignage.
 *
 * @throws TtsUnconfiguredError si le Worker n'a pas de clé TTS (HTTP 503).
 */
export async function synthesizeText(
  text: string,
  lang: TtsLang,
  opts: { timeoutMs?: number } = {},
): Promise<Blob> {
  const clean = text.trim();
  const { voice, languageCode } = TTS_VOICES[lang];
  const cacheId = ttsTextCacheId(clean, lang);

  const cached = await getTtsCache(cacheId);
  if (cached) return cached.audio;

  const { audio } = await postTts(
    { text: clean, voice, languageCode, rate: RATE },
    opts.timeoutMs ?? 30_000,
  );
  await putTtsCache(cacheId, audio, []);
  return audio;
}
