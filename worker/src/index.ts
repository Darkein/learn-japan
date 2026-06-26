// Worker de génération — détenteur de la clé Gemini, porte d'auth.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et reçoit le texte.
//
// Génération SYNCHRONE : pour une courte histoire, Gemini répond en quelques secondes,
// bien dans les limites d'un Worker. Pas de KV ni de R2 → rien à provisionner.
//
// TTS SYNCHRONE aussi (POST /tts) : on synthétise une phrase à la demande et on renvoie
// l'audio + les timepoints. Le client met en cache localement (IndexedDB) → pas de R2.

export interface Env {
  // Clé Gemini principale (SECRET). Des clés additionnelles GEMINI_API_KEY_2,
  // _3, … (jusqu'à _10) sont lues dynamiquement → répartir le quota / repli sur
  // un autre projet quand le premier est à 429. Voir geminiKeyEnvs().
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  // Chaîne de repli (JSON) : [{ provider, model, keyEnv }], du plus puissant au
  // plus léger. Optionnel — un défaut codé en dur prend le relais (resolveChain).
  MODEL_CHAIN?: string;
  REQUIRE_ACCESS: string;
  // TTS (mode voiture / écoute d'article). Clé Google Cloud Text-to-Speech : un
  // SECRET (wrangler secret put GOOGLE_TTS_API_KEY). Sans elle, /tts répond 503 et
  // le client bascule sur la Web Speech API du navigateur.
  GOOGLE_TTS_API_KEY?: string;
  TTS_VOICE?: string;
  TTS_RATE?: string;
}

interface GenerateRequest {
  kind?: "story" | "lesson";
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  prompt?: string;
  level?: number;
}

interface TtsRequest {
  // Surfaces des tokens d'UNE phrase, dans l'ordre. Un repère SSML est inséré
  // avant chaque segment → on récupère l'horodatage de chaque mot (surlignage).
  segments?: string[];
  // Alternative à `segments` : un texte entier à synthétiser sans timepoints (mode
  // podcast — transitions, quiz, phrases FR). Ignoré si `segments` est fourni.
  text?: string;
  voice?: string;
  rate?: number;
  // Langue BCP-47 (défaut ja-JP). Détermine la voix par défaut si `voice` est absent.
  languageCode?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Vérifie la présence du jeton Cloudflare Access (si exigé). */
function accessOk(req: Request, env: Env): boolean {
  if (env.REQUIRE_ACCESS !== "true") return true;
  return req.headers.has("Cf-Access-Jwt-Assertion");
}

function buildPrompt(r: GenerateRequest): string {
  // Le client a déjà composé un prompt complet (cadrage FR ou histoire JP, avec sa
  // propre consigne de longueur et de format) → on le transmet tel quel.
  if (r.prompt) return r.prompt;
  // Sinon : génération libre (lecteur) à partir de paramètres simples.
  const parts = [
    "Écris un petit texte en japonais (court récit, brève ou dialogue) adapté à un apprenant.",
    r.level ? `Niveau JLPT visé : N${r.level}.` : "",
    r.theme ? `Thème : ${r.theme}.` : "",
    r.kanji?.length ? `Mets en avant ces kanji : ${r.kanji.join(" ")}.` : "",
    r.grammar?.length ? `Illustre ces points de grammaire : ${r.grammar.join(", ")}.` : "",
    "Vise environ 150 à 300 caractères japonais, en 2 à 4 courts paragraphes.",
    "Réponds uniquement avec le texte japonais (pas de furigana, pas de traduction).",
  ];
  return parts.filter(Boolean).join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 429 (quota), 500/503 (modèle surchargé) sont transitoires → on réessaie.
const TRANSIENT = new Set([429, 500, 503]);

// Un maillon de la chaîne de génération. `keyEnv` nomme la variable d'env qui
// porte la clé → forme extensible (un autre fournisseur = un autre keyEnv/adaptateur).
interface ModelEntry {
  provider: "gemini";
  model: string;
  keyEnv: string;
}

/**
 * Noms des variables d'env portant une clé Gemini, dans l'ordre de préférence :
 * GEMINI_API_KEY puis GEMINI_API_KEY_2, _3, … (ajouter une clé = répartir le
 * quota / un repli quand un projet est à 429). Seules les clés non vides comptent.
 */
function geminiKeyEnvs(env: Env): string[] {
  const rec = env as unknown as Record<string, string | undefined>;
  const names = ["GEMINI_API_KEY"];
  for (let i = 2; i <= 10; i++) names.push(`GEMINI_API_KEY_${i}`);
  return names.filter((n) => (rec[n] ?? "").trim().length > 0);
}

/** Chaîne de modèles, du plus puissant au plus léger. `MODEL_CHAIN` (JSON) prime. */
function resolveChain(env: Env): ModelEntry[] {
  if (env.MODEL_CHAIN) {
    try {
      const parsed = JSON.parse(env.MODEL_CHAIN) as ModelEntry[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // JSON invalide → on retombe sur le défaut ci-dessous.
    }
  }
  const primary = env.GEMINI_MODEL || "gemini-2.5-flash";
  // Du plus puissant au plus léger, par palier (pro → flash → flash-lite), la
  // génération la plus récente d'abord dans chaque palier. `primary` (le modèle
  // configuré) est inséré juste après le pro ; le Set dédoublonne si besoin.
  const models = [...new Set([
    "gemini-2.5-pro",
    primary,
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
  ])];
  // Au moins GEMINI_API_KEY même absente → laisse generate() détecter l'absence
  // de clé et répondre le stub. Sinon : toutes les clés configurées.
  const keyEnvs = geminiKeyEnvs(env);
  const envs = keyEnvs.length ? keyEnvs : ["GEMINI_API_KEY"];
  // Modèle d'abord, clés ensuite : un 429 est par projet/clé → on change de clé
  // pour GARDER le meilleur modèle avant de dégrader vers un modèle plus léger.
  return models.flatMap((model) =>
    envs.map((keyEnv) => ({ provider: "gemini" as const, model, keyEnv })),
  );
}

function keyFor(env: Env, entry: ModelEntry): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[entry.keyEnv];
}

/** Config de génération : assez de tokens pour un petit article, sans gaspiller en « thinking ». */
function genConfig(model: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = { maxOutputTokens: 4096 };
  // Gemini 2.5 Flash active le « thinking » par défaut : il consomme le budget de
  // sortie et tronque/vide les textes longs → on le coupe pour cet usage.
  if (/2\.5-flash/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}

/** Un seul modèle, avec backoff exponentiel sur erreurs transitoires (429/500/503). */
async function callModel(env: Env, entry: ModelEntry, prompt: string): Promise<string> {
  const key = keyFor(env, entry);
  if (!key) throw new Error(`${entry.keyEnv} manquant pour ${entry.model}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${entry.model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig(entry.model),
  });

  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!text.trim()) throw new Error(`Réponse vide (${entry.model})`);
      return text.trim();
    }

    lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
    if (!TRANSIENT.has(res.status) || attempt === maxAttempts) break;
    await sleep(500 * 2 ** (attempt - 1)); // 0,5s → 1s → 2s
  }
  throw new Error(`${entry.model}: ${lastErr || "échec inconnu"}`);
}

/**
 * Génère via la chaîne ordonnée : sur quota épuisé ou échec persistant d'un modèle,
 * on bascule sur le suivant. N'échoue qu'une fois TOUTE la chaîne épuisée.
 */
async function generate(env: Env, prompt: string): Promise<string> {
  const chain = resolveChain(env);
  // Aucune clé configurée nulle part → réponse stub (squelette testable hors-ligne).
  if (!chain.some((e) => keyFor(env, e))) {
    return `【stub】${prompt.slice(0, 40)}… (configurer GEMINI_API_KEY)`;
  }

  const errors: string[] = [];
  for (const entry of chain) {
    try {
      const text = await callModel(env, entry, prompt);
      if (errors.length) console.warn(`Repli sur ${entry.model} après : ${errors.join(" | ")}`);
      return text;
    } catch (e) {
      errors.push(String(e));
      // Modèle suivant dans la chaîne…
    }
  }
  throw new Error(`Tous les modèles ont échoué : ${errors.join(" | ")}`);
}

// ---------- TTS (Google Cloud Text-to-Speech) -------------------------------

const DEFAULT_TTS_VOICE = "ja-JP-Neural2-B";
const DEFAULT_FR_VOICE = "fr-FR-Neural2-A";

/** Voix Cloud TTS par défaut selon la langue (BCP-47). */
function defaultVoiceFor(languageCode: string): string {
  return languageCode.toLowerCase().startsWith("fr") ? DEFAULT_FR_VOICE : DEFAULT_TTS_VOICE;
}

/** Échappe les caractères réservés XML pour une insertion sûre dans le SSML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** SSML d'une phrase : un <mark name="tN"/> avant chaque token → timepoints par mot. */
function buildSsml(segments: string[]): string {
  const body = segments
    .map((seg, i) => `<mark name="t${i}"/>${escapeXml(seg)}`)
    .join("");
  return `<speak>${body}</speak>`;
}

interface TtsResult {
  audio: string; // MP3 en base64
  marks: { i: number; t: number }[]; // i = index token, t = secondes
}

/**
 * Synthétise une phrase via Cloud TTS (v1beta1 pour les timepoints SSML), avec le
 * même backoff exponentiel sur transitoires que la génération de texte.
 */
async function synthesize(env: Env, body: TtsRequest): Promise<TtsResult> {
  const key = env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error("tts_unconfigured");

  // Deux modes : `segments` (phrase tokenisée → timepoints par mot, pour le lecteur
  // d'article) ou `text` (texte entier sans timepoints, pour le podcast).
  const segments = (body.segments ?? []).filter((s) => s.length > 0);
  const plainText = (body.text ?? "").trim();
  if (!segments.length && !plainText) throw new Error("texte vide");
  const useMarks = segments.length > 0;

  const languageCode = body.languageCode || "ja-JP";
  const voice = body.voice || (languageCode === "ja-JP" ? env.TTS_VOICE : undefined) || defaultVoiceFor(languageCode);
  const rate = body.rate ?? Number(env.TTS_RATE ?? "1") ?? 1;
  const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${key}`;
  const payload = JSON.stringify({
    input: useMarks ? { ssml: buildSsml(segments) } : { text: plainText },
    voice: { languageCode, name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate: rate },
    ...(useMarks ? { enableTimePointing: ["SSML_MARK"] } : {}),
  });

  const maxAttempts = 4;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    if (res.ok) {
      const data = (await res.json()) as {
        audioContent?: string;
        timepoints?: { markName?: string; timeSeconds?: number }[];
      };
      if (!data.audioContent) throw new Error("Réponse TTS sans audio");
      const marks = (data.timepoints ?? [])
        .map((tp) => ({ i: Number((tp.markName ?? "t0").slice(1)), t: tp.timeSeconds ?? 0 }))
        .sort((a, b) => a.t - b.t);
      return { audio: data.audioContent, marks };
    }

    lastErr = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
    if (!TRANSIENT.has(res.status) || attempt === maxAttempts) break;
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw new Error(`TTS : ${lastErr || "échec inconnu"}`);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!accessOk(req, env)) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);

    // POST /generate → { text } (synchrone)
    if (req.method === "POST" && url.pathname === "/generate") {
      const body = (await req.json().catch(() => ({}))) as GenerateRequest;
      try {
        const text = await generate(env, buildPrompt(body));
        return json({ text });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // POST /tts → { audio (base64 MP3), marks } (synthèse d'une phrase + timepoints)
    if (req.method === "POST" && url.pathname === "/tts") {
      const body = (await req.json().catch(() => ({}))) as TtsRequest;
      try {
        return json(await synthesize(env, body));
      } catch (e) {
        // Clé absente → 503 explicite : le client bascule sur la Web Speech API.
        if (String(e).includes("tts_unconfigured")) return json({ error: "tts_unconfigured" }, 503);
        return json({ error: String(e) }, 502);
      }
    }

    if (url.pathname === "/") return json({ ok: true, service: "learn-japan-gen" });
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
