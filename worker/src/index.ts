// Worker de génération — détenteur de la clé Gemini, porte d'auth.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et reçoit le texte.
//
// Génération SYNCHRONE : pour une courte histoire, Gemini répond en quelques secondes,
// bien dans les limites d'un Worker.
//
// TTS SYNCHRONE aussi (POST /tts) : on synthétise une phrase à la demande et on renvoie
// l'audio + les timepoints.
//
// CACHE R2 — tout ce que le Worker génère (texte et audio) est mis en cache sur R2 sous
// une clé déterministe (voir cache.ts) : un appel identique est servi depuis R2 sans
// rappeler l'API amont. Bindings optionnels (GEN_CACHE / TTS_CACHE) : sans eux, retour
// à la génération à la volée. `GET /` rapporte leur présence pour vérifier la config.
//
// SÉCURITÉ — le client ne pilote PLUS le prompt : il poste seulement des paramètres
// structurés ({ kind, level, theme, … }), et c'est le Worker qui compose le prompt depuis
// des gabarits fixes (voir prompts.ts). Aucune instruction libre ne transite → l'endpoint
// ne peut pas être détourné en proxy LLM générique « hors japonais ».

import { cleanSlug, cleanVariant, composePrompt, type GenerateRequest } from "./prompts";
import { cacheGet, cachePut, genCacheKey, lessonCacheKey, lessonStoryCacheKey, listGenerated, ttsCacheKey } from "./cache";

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
  // Cache R2 de TOUT le contenu généré (économise le quota amont). OPTIONNELS : sans
  // binding, le Worker génère à la volée sans cache (voir cache.ts).
  //   GEN_CACHE → textes Gemini (bucket learn-japan-content)
  //   TTS_CACHE → audio Cloud TTS  (bucket learn-japan-audio)
  GEN_CACHE?: R2Bucket;
  TTS_CACHE?: R2Bucket;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 429 (quota), 500/503 (modèle surchargé) sont transitoires → on réessaie.
const TRANSIENT = new Set([429, 500, 503]);

/**
 * POST JSON avec backoff exponentiel (0,5 s → 1 s → 2 s) sur erreurs transitoires.
 * Renvoie la DERNIÈRE réponse, réussie ou non : l'appelant interprète le statut/corps.
 */
async function postWithRetry(url: string, body: string, maxAttempts = 4): Promise<Response> {
  let res!: Response;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok || !TRANSIENT.has(res.status) || attempt === maxAttempts) break;
    await sleep(500 * 2 ** (attempt - 1));
  }
  return res;
}

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

/** Au moins une clé Gemini configurée ? Sinon generate() renvoie un stub (à NE PAS cacher). */
function hasAnyKey(env: Env): boolean {
  return resolveChain(env).some((e) => keyFor(env, e));
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

  const res = await postWithRetry(url, body);
  if (!res.ok) {
    throw new Error(`${entry.model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) throw new Error(`Réponse vide (${entry.model})`);
  return text.trim();
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
async function synthesize(env: Env, body: TtsRequest, refresh = false): Promise<TtsResult> {
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
  // `Number("")`/`Number("abc")` donnent NaN → repli sur 1 (sinon NaN part à Cloud TTS
  // et pollue la clé de cache).
  const rate = body.rate ?? (Number(env.TTS_RATE) || 1);
  const ssml = useMarks ? buildSsml(segments) : undefined;

  // Cache R2 de l'audio (économise le quota Cloud TTS). Clé = paramètres effectifs résolus.
  const cacheKey = await ttsCacheKey({ ssml, text: useMarks ? undefined : plainText, voice, rate, languageCode });
  if (!refresh) {
    const hit = await cacheGet<TtsResult>(env.TTS_CACHE, cacheKey);
    if (hit?.audio) return hit;
  }

  const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${key}`;
  const payload = JSON.stringify({
    input: useMarks ? { ssml } : { text: plainText },
    voice: { languageCode, name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate: rate },
    ...(useMarks ? { enableTimePointing: ["SSML_MARK"] } : {}),
  });

  const res = await postWithRetry(url, payload);
  if (!res.ok) {
    throw new Error(`TTS : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    audioContent?: string;
    timepoints?: { markName?: string; timeSeconds?: number }[];
  };
  if (!data.audioContent) throw new Error("Réponse TTS sans audio");
  const marks = (data.timepoints ?? [])
    .map((tp) => ({ i: Number((tp.markName ?? "t0").slice(1)), t: tp.timeSeconds ?? 0 }))
    .sort((a, b) => a.t - b.t);
  const result: TtsResult = { audio: data.audioContent, marks };
  await cachePut(env.TTS_CACHE, cacheKey, result);
  return result;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!accessOk(req, env)) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);

    // POST /generate → { text, cached } (synchrone, avec cache R2)
    if (req.method === "POST" && url.pathname === "/generate") {
      const body = (await req.json().catch(() => ({}))) as GenerateRequest & { refresh?: boolean };
      // Composition + validation des entrées AVANT l'appel modèle : un `kind` inconnu
      // ou une requête malformée est un 400 (faute du client), pas un 502 (panne amont).
      let prompt: string;
      try {
        prompt = composePrompt(body);
      } catch (e) {
        return json({ error: String(e) }, 400);
      }

      // Cache R2 : même prompt ⇒ même contenu → on sert le déjà-généré sans rappeler Gemini.
      // `refresh` (corps ou ?refresh=1) force une régénération (et rafraîchit le cache).
      const refresh = body.refresh === true || url.searchParams.get("refresh") === "1";

      // Les leçons et histoires de leçons utilisent des clés R2 structurées (listables par
      // `/generated`). Les autres kinds restent sur le hash de prompt (opaque, partagé par
      // contenu identique quel que soit l'appelant).
      const lessonId = cleanSlug(body.lessonId);
      let key: string;
      if (body.kind === "lesson" && lessonId) {
        key = lessonCacheKey(lessonId);
      } else if (body.kind === "lesson-story" && lessonId) {
        const variant = cleanVariant(body.variant);
        key = lessonStoryCacheKey(lessonId, variant);
      } else {
        key = await genCacheKey(body.kind ?? "story", prompt);
      }

      if (!refresh) {
        const hit = await cacheGet<{ text: string }>(env.GEN_CACHE, key);
        if (hit?.text) return json({ text: hit.text, cached: true });
      }

      try {
        const keyed = hasAnyKey(env); // calculé une fois (resolveChain est reconstruit à chaque appel)
        const text = await generate(env, prompt);
        // On ne met en cache que de vraies générations (pas le stub « clé absente »).
        if (keyed) await cachePut(env.GEN_CACHE, key, { text, createdAt: Date.now() });
        return json({ text, cached: false });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    // GET /generated → liste le contenu pré-généré dans R2 (leçons + variantes d'histoires).
    // Appelé une seule fois au chargement de l'app pour afficher les leçons disponibles.
    if (req.method === "GET" && url.pathname === "/generated") {
      const lessons = await listGenerated(env.GEN_CACHE);
      return json({ lessons });
    }

    // POST /tts → { audio (base64 MP3), marks } (synthèse d'une phrase + timepoints)
    if (req.method === "POST" && url.pathname === "/tts") {
      const body = (await req.json().catch(() => ({}))) as TtsRequest & { refresh?: boolean };
      const refresh = body.refresh === true || url.searchParams.get("refresh") === "1";
      try {
        return json(await synthesize(env, body, refresh));
      } catch (e) {
        // Clé absente → 503 explicite : le client bascule sur la Web Speech API.
        if (String(e).includes("tts_unconfigured")) return json({ error: "tts_unconfigured" }, 503);
        return json({ error: String(e) }, 502);
      }
    }

    // Santé + diagnostic : indique si les bindings de cache R2 sont bien attachés au
    // Worker déployé (booléens, rien de secret). `gen:false` ⇒ /generate ne persiste
    // rien (binding manquant) → R2 reste vide. Sert à vérifier la config d'un coup d'œil.
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "learn-japan-gen",
        cache: { gen: Boolean(env.GEN_CACHE), tts: Boolean(env.TTS_CACHE) },
      });
    }
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
