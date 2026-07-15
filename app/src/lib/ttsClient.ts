// Client TTS : synthèse d'un énoncé via le Worker (Cloud TTS), avec cache local.
// Le Worker (et lui seul) détient la clé Google → rien à voler côté client. L'audio
// et les timepoints sont mis en cache dans IndexedDB (par énoncé) : un énoncé déjà
// écouté n'est jamais re-synthétisé (quota) et reste disponible hors-ligne.
//
// Deux modes, alignés sur POST /tts du Worker :
//  - synthesizeSentence : phrase tokenisée → audio + timepoints par mot (surlignage) ;
//  - synthesizeParts : fragments multi-voix (FR/JA) lus en UN énoncé SSML <voice>,
//    sans timepoints — segments podcast, un segment monolingue = un seul fragment.
//
// Les clés de cache (ttsSentenceCacheId / ttsPartsCacheId) sont exportées : le
// téléchargement hors-ligne (lib/download.ts) les relit pour GARANTIR que tout
// l'audio d'un élément « téléchargé » est bien présent en cache.

import { TTS_VOICES, WORKER_URL, type TtsLang } from "./config";
import { getTtsCache, putTtsCache } from "./db";

/** Fragment voicé d'un énoncé multi-voix (prose FR avec japonais inline, paire JA+FR). */
export interface TtsPart {
  lang: TtsLang;
  text: string;
}

export interface SentenceAudio {
  audio: Blob;
  /** Timepoints par token : i = index (global) du token, t = secondes dans l'audio. */
  marks: { i: number; t: number }[];
}

const VOICE = TTS_VOICES.ja.voice;
const RATE = 1.0;

/** Worker sans clé TTS (503) : lecture audio et téléchargement hors-ligne impossibles. */
const TTS_UNCONFIGURED_MESSAGE = "Synthèse vocale non configurée côté serveur.";

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

/** Poste une requête au Worker /tts et renvoie l'audio décodé (+ timepoints éventuels). */
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
    throw new Error(`Worker injoignable (TTS) : ${String(e)}`);
  }

  if (res.status === 503) throw new Error(TTS_UNCONFIGURED_MESSAGE);

  const data = (await res.json().catch(() => ({}))) as {
    audio?: string;
    marks?: { i: number; t: number }[];
    error?: string;
  };
  if (!res.ok || data.error) throw new Error(data.error ?? `tts HTTP ${res.status}`);
  if (!data.audio) throw new Error("Réponse TTS vide");

  return { audio: base64ToBlob(data.audio), marks: data.marks ?? [] };
}

// ---------- Phrase tokenisée (timepoints, surlignage) -------------------------

/** Clé de cache IndexedDB d'une phrase tokenisée (voix japonaise du lecteur). */
export function ttsSentenceCacheId(segments: string[]): string {
  return `${VOICE}|${RATE}|${segments.join("")}`;
}

/**
 * Synthétise une phrase (suite de surfaces de tokens) → audio + timepoints.
 * `marks[].i` est ré-indexé sur l'index GLOBAL du premier token via `baseIndex`,
 * pour que le surlignage cible directement la bonne cellule de mot du lecteur.
 */
export async function synthesizeSentence(
  segments: string[],
  baseIndex = 0,
  opts: { timeoutMs?: number } = {},
): Promise<SentenceAudio> {
  const cacheId = ttsSentenceCacheId(segments);

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

// ---------- Énoncé multi-voix (segments podcast) ------------------------------

/** Clé de cache IndexedDB d'un énoncé multi-voix : débit + (voix, texte) de chaque fragment. */
export function ttsPartsCacheId(parts: TtsPart[]): string {
  return `parts|${RATE}|${parts.map((p) => `${TTS_VOICES[p.lang].voice}:${p.text.trim()}`).join("\u001f")}`;
}

/**
 * Synthétise un énoncé multi-voix (fragments FR/JA lus d'une traite) → Blob MP3, mis en
 * cache (mêmes invariants que `synthesizeSentence` : zéro re-synthèse, offline). Les
 * fragments partent bruts (leur espacement compte dans le SSML) ; seul l'id de cache
 * est normalisé.
 */
export async function synthesizeParts(parts: TtsPart[], opts: { timeoutMs?: number } = {}): Promise<Blob> {
  const cacheId = ttsPartsCacheId(parts);

  const cached = await getTtsCache(cacheId);
  if (cached) return cached.audio;

  const { audio } = await postTts(
    { parts: parts.map((p) => ({ text: p.text, ...TTS_VOICES[p.lang] })), rate: RATE },
    opts.timeoutMs ?? 30_000,
  );
  await putTtsCache(cacheId, audio, []);
  return audio;
}
