// Worker de génération — détenteur de la clé Together AI (fournisseur par défaut), porte d'auth.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et reçoit le texte.
//
// Génération SYNCHRONE : pour une courte histoire, le modèle répond en quelques secondes,
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

import { buildStoryIllustrationPrompt, cleanRev, cleanSlug, cleanVariant, composePrompt, type GenerateRequest } from "./prompts";
import { cacheGet, cachePut, genCacheKey, lessonCacheKey, lessonStoryCacheKey, listGenerated, ttsCacheKey } from "./cache";

export interface Env {
  // FOURNISSEUR PAR DÉFAUT : Together AI (API compatible OpenAI). Une SEULE clé suffit
  // (wrangler secret put TOGETHER_API_KEY) → fini la jonglerie des 10 clés Gemini et le
  // piège du free tier supprimé dès qu'on active la facturation. Voir callTogether().
  TOGETHER_API_KEY?: string;
  // Modèle texte Together (ID complet, ex. "Qwen/Qwen2.5-72B-Instruct-Turbo"). Optionnel :
  // sans lui, un défaut codé en dur prend le relais (togetherModels()).
  TOGETHER_MODEL?: string;
  // Modèle IMAGE Together (illustration d'histoire), ex. "black-forest-labs/FLUX.1-schnell".
  // Optionnel : défaut codé en dur (imageModel()). Best-effort — sans image l'histoire passe quand même.
  TOGETHER_IMAGE_MODEL?: string;
  // Gemini reste supporté comme REPLI OPTIONNEL via MODEL_CHAIN (provider "gemini"). Ces
  // variables ne servent que dans ce cas ; le chemin par défaut n'en dépend plus.
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_IMAGE_MODEL?: string;
  // Chaîne de repli (JSON) : [{ provider, model, keyEnv }], du plus capable au plus
  // léger. Optionnel — sans elle, le défaut Together (resolveChain) prend le relais.
  // Permet de mélanger les fournisseurs, ex. Together en primaire + Gemini en secours.
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
  //   GEN_CACHE → textes générés (bucket learn-japan-content)
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

// 429 (rate limit), 500/503 (modèle surchargé) sont transitoires → on réessaie.
// Les 429 Together sont des limites DYNAMIQUES (« shift with live model capacity »)
// qui se rétablissent en quelques secondes : les réessayer sur place donne sa chance
// au modèle primaire au lieu de dégrader systématiquement vers le repli. Un 429 de
// crédits épuisés, lui, persiste — la chaîne de repli (generate()) le couvre après
// épuisement des tentatives, MAX_TEXT_CALLS bornant le total de sous-requêtes.
const TRANSIENT = new Set([429, 500, 503]);

/**
 * POST JSON avec backoff exponentiel (0,5 s → 1 s → 2 s) sur erreurs transitoires.
 * Renvoie la DERNIÈRE réponse, réussie ou non : l'appelant interprète le statut/corps.
 * `retryOn` restreint les statuts réessayés (défaut : tous les transitoires) ; `maxAttempts`
 * borne le nombre de fetch — capital car Cloudflare limite les sous-requêtes/invocation.
 */
async function postWithRetry(
  url: string,
  body: string,
  opts: { maxAttempts?: number; retryOn?: Set<number>; headers?: Record<string, string> } = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const retryOn = opts.retryOn ?? TRANSIENT;
  let res!: Response;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body,
    });
    if (res.ok || !retryOn.has(res.status) || attempt === maxAttempts) break;
    await sleep(500 * 2 ** (attempt - 1));
  }
  return res;
}

// Un maillon de la chaîne de génération. `keyEnv` nomme la variable d'env qui porte la
// clé → forme extensible : chaque `provider` a son adaptateur (callTogether/callGemini).
interface ModelEntry {
  provider: "together" | "gemini";
  model: string;
  keyEnv: string;
}

// Cloudflare plafonne les sous-requêtes (fetch) par invocation de Worker : 50 sur le
// plan gratuit, 1000 en payant. MAX_TEXT_CALLS borne DUR les tentatives de génération
// de texte par invocation (l'illustration n'en fait qu'une, best-effort) → jamais de
// « Too many subrequests », avec de la marge pour les lectures/écritures R2.
const MAX_TEXT_CALLS = 12;

/**
 * Modèle texte Together (ID complet). UN SEUL modèle, sans repli : tout le contenu
 * (leçons, histoires) doit garder un style consistant — un repli vers un modèle plus
 * faible produirait des textes hétérogènes mis en cache définitivement dans R2. Les 429
 * dynamiques sont absorbés par MODEL_RETRY ; un échec persistant remonte au client, qui
 * sait relancer (jobs). MODEL_CHAIN reste le moyen EXPLICITE de configurer un repli.
 */
function togetherModels(env: Env): string[] {
  return [(env.TOGETHER_MODEL ?? "").trim() || "deepseek-ai/DeepSeek-V4-Pro"];
}

/**
 * Chaîne ordonnée de tentatives (fournisseur+modèle+clé). `MODEL_CHAIN` (JSON) prime tel
 * quel — utile pour mélanger les fournisseurs (ex. Together primaire + Gemini en secours).
 * Défaut : Together seul, une clé, du modèle le plus cohérent au plus léger.
 */
function resolveChain(env: Env): ModelEntry[] {
  if (env.MODEL_CHAIN) {
    try {
      const parsed = JSON.parse(env.MODEL_CHAIN) as ModelEntry[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // JSON invalide → on retombe sur le défaut ci-dessous.
    }
  }
  // keyEnv toujours "TOGETHER_API_KEY" même absente → generate() détecte l'absence de
  // clé et répond le stub (squelette testable hors-ligne, jamais mis en cache).
  return togetherModels(env).map((model) => ({
    provider: "together" as const,
    model,
    keyEnv: "TOGETHER_API_KEY",
  }));
}

function keyFor(env: Env, entry: ModelEntry): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[entry.keyEnv];
}

/** Au moins une clé configurée dans la chaîne ? Sinon generate() renvoie un stub (à NE PAS cacher). */
function hasAnyKey(env: Env): boolean {
  return resolveChain(env).some((e) => keyFor(env, e));
}

/** Config Gemini : assez de tokens pour un petit article, sans gaspiller en « thinking ». */
function genConfig(model: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = { maxOutputTokens: 4096 };
  // Gemini 2.5 Flash active le « thinking » par défaut : il consomme le budget de
  // sortie et tronque/vide les textes longs → on le coupe pour cet usage.
  if (/2\.5-flash/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}

// 4 tentatives par modèle (backoff 0,5 s → 1 s → 2 s) sur 429/500/503 : les limites
// dynamiques Together se rétablissent en secondes, et comme il n'y a plus de modèle de
// repli par défaut (consistance de style), on insiste avant de remonter l'échec au
// client (jobs relançables). Budget borné par MAX_TEXT_CALLS quoi qu'il arrive.
const MODEL_RETRY = { maxAttempts: 4, retryOn: TRANSIENT } as const;

/** Together AI — API compatible OpenAI (chat/completions), clé en Bearer. */
async function callTogether(model: string, key: string, prompt: string): Promise<string> {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4096,
    // 0.7 : assez de variété pour les histoires, moins d'approximations factuelles dans
    // les leçons qu'à 0.8 (vu : une tournure agrammaticale présentée comme correcte).
    temperature: 0.7,
    // Les modèles hybrides « thinking » (DeepSeek V4, Kimi K2.6…) brûlent sinon tout le
    // max_tokens en raisonnement et renvoient un contenu vide/tronqué. Les modèles sans
    // template de thinking (Qwen3 Instruct, Llama) ignorent la variable sans erreur.
    chat_template_kwargs: { thinking: false },
  });
  const res = await postWithRetry("https://api.together.xyz/v1/chat/completions", body, {
    ...MODEL_RETRY,
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data?.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`Réponse vide (${model})`);
  return text.trim();
}

/** Gemini — repli optionnel (via MODEL_CHAIN), clé dans l'URL, format generateContent. */
async function callGemini(model: string, key: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig(model),
  });
  const res = await postWithRetry(url, body, MODEL_RETRY);
  if (!res.ok) {
    throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) throw new Error(`Réponse vide (${model})`);
  return text.trim();
}

/** Un seul maillon : route vers l'adaptateur du fournisseur. */
async function callModel(env: Env, entry: ModelEntry, prompt: string): Promise<string> {
  const key = keyFor(env, entry);
  if (!key) throw new Error(`${entry.keyEnv} manquant pour ${entry.model}`);
  return entry.provider === "gemini"
    ? callGemini(entry.model, key, prompt)
    : callTogether(entry.model, key, prompt);
}

/**
 * Génère via la chaîne ordonnée : sur échec persistant d'un maillon, on passe au
 * suivant. Par défaut la chaîne n'a qu'UN maillon (consistance de style) ; seul un
 * MODEL_CHAIN explicite réintroduit une dégradation multi-modèles/fournisseurs.
 */
async function generate(env: Env, prompt: string): Promise<string> {
  const chain = resolveChain(env);
  // Aucune clé configurée nulle part → réponse stub (squelette testable hors-ligne).
  if (!chain.some((e) => keyFor(env, e))) {
    return `【stub】${prompt.slice(0, 40)}… (configurer TOGETHER_API_KEY)`;
  }

  const errors: string[] = [];
  let attempts = 0;
  for (const entry of chain) {
    // Garde-fou sous-requêtes : on ne dépasse jamais MAX_TEXT_CALLS appels amont,
    // quel que soit le nombre de clés/modèles → jamais de « Too many subrequests ».
    if (attempts >= MAX_TEXT_CALLS) break;
    attempts++;
    try {
      const text = await callModel(env, entry, prompt);
      if (errors.length) console.warn(`Repli sur ${entry.model} après : ${errors.join(" | ")}`);
      return text;
    } catch (e) {
      errors.push(String(e));
      // Clé/modèle suivant dans la chaîne…
    }
  }
  throw new Error(`Tous les modèles ont échoué : ${errors.join(" | ")}`);
}

// ---------- Génération d'IMAGE (illustration d'histoire) --------------------
// Repliée dans /generate (aucun endpoint image public). Best-effort : l'image est
// décorative, tout échec renvoie null et l'histoire est servie sans illustration.

/** Modèle image Together : `TOGETHER_IMAGE_MODEL` s'il est défini, sinon FLUX schnell
 *  serverless (~0,002 $ l'image en 1024×768 ; la variante -Free n'est plus serverless → 400). */
function imageModel(env: Env): string {
  return (env.TOGETHER_IMAGE_MODEL ?? "").trim() || "black-forest-labs/FLUX.1-schnell";
}

interface GeneratedImage {
  data: string; // image encodée en base64
  mime: string; // ex. "image/png"
}

/** Uint8Array → base64 (par blocs pour ne pas exploser la pile sur une grande image). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Génère une illustration via Together (FLUX, endpoint OpenAI /images/generations).
 * Together renvoie par DÉFAUT une URL hébergée (pas du base64) → on rapatrie l'image et
 * on l'encode. Best-effort et SANS backoff (maxAttempts:1) : tout échec renvoie null (et
 * est loggé pour `wrangler tail`), l'histoire est alors servie sans image.
 */
async function generateImage(env: Env, prompt: string): Promise<GeneratedImage | null> {
  const key = env.TOGETHER_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({
    model: imageModel(env),
    prompt,
    width: 1024,
    height: 768,
    steps: 4, // FLUX schnell est distillé pour 1–4 étapes
    n: 1,
  });
  try {
    const res = await postWithRetry("https://api.together.xyz/v1/images/generations", body, {
      maxAttempts: 1,
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn(`Image: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const first = ((await res.json()) as { data?: { b64_json?: string; url?: string }[] })?.data?.[0];
    // b64_json si jamais demandé/supporté, sinon l'URL FLUX par défaut → fetch + encode.
    if (first?.b64_json) return { data: first.b64_json, mime: "image/png" };
    if (first?.url) {
      const img = await fetch(first.url);
      if (!img.ok) {
        console.warn(`Image URL: HTTP ${img.status}`);
        return null;
      }
      const bytes = new Uint8Array(await img.arrayBuffer());
      return { data: bytesToBase64(bytes), mime: img.headers.get("content-type") || "image/png" };
    }
    console.warn("Image: réponse Together sans url ni b64_json");
  } catch (e) {
    console.warn(`Image: ${String(e)}`);
  }
  return null;
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
      const body = (await req.json().catch(() => ({}))) as GenerateRequest & {
        refresh?: boolean;
        backfillImage?: boolean;
      };
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
        key = lessonCacheKey(lessonId, cleanRev(body.rev));
      } else if (body.kind === "lesson-story" && lessonId) {
        const variant = cleanVariant(body.variant);
        key = lessonStoryCacheKey(lessonId, variant);
      } else {
        key = await genCacheKey(body.kind ?? "story", prompt);
      }

      // Une histoire (libre ou de leçon) est illustrée : l'image voyage DANS le même objet
      // de cache et la même réponse que le texte (aucun endpoint image dédié).
      const isStory = body.kind === "story" || body.kind === "lesson-story" || body.kind === undefined;

      if (!refresh) {
        const hit = await cacheGet<{ text: string; image?: string; mime?: string; createdAt?: number }>(
          env.GEN_CACHE,
          key,
        );
        if (hit?.text) {
          // Backfill : les histoires cachées avant la fonctionnalité d'illustration n'ont
          // pas d'image — on la génère et on réécrit l'objet de cache. UNIQUEMENT sur
          // demande explicite du client (`backfillImage`) : les modèles image sont hors
          // free tier (quota 0 → 429), on ne ralentit pas chaque hit avec des retries.
          if (isStory && !hit.image && body.backfillImage === true && hasAnyKey(env)) {
            try {
              const img = await generateImage(env, buildStoryIllustrationPrompt(hit.text, undefined, body.level));
              if (img) {
                hit.image = img.data;
                hit.mime = img.mime;
                await cachePut(env.GEN_CACHE, key, hit);
              }
            } catch {
              // best-effort : l'histoire est servie sans image
            }
          }
          return json({ text: hit.text, cached: true, ...(hit.image ? { image: hit.image, mime: hit.mime } : {}) });
        }
      }

      try {
        const keyed = hasAnyKey(env); // calculé une fois (resolveChain est reconstruit à chaque appel)
        const text = await generate(env, prompt);

        // Illustration (best-effort) : générée APRÈS le texte, à partir de lui → contexte
        // complet. Un échec (modèle absent, quota, réponse sans image) n'empêche jamais de
        // servir l'histoire. Jamais pour le stub « clé absente ».
        let image: GeneratedImage | null = null;
        if (keyed && isStory) {
          try {
            image = await generateImage(env, buildStoryIllustrationPrompt(text, undefined, body.level));
          } catch {
            image = null;
          }
        }

        // On ne met en cache que de vraies générations (pas le stub « clé absente »).
        if (keyed) {
          await cachePut(env.GEN_CACHE, key, {
            text,
            createdAt: Date.now(),
            ...(image ? { image: image.data, mime: image.mime } : {}),
          });
        }
        return json({ text, cached: false, ...(image ? { image: image.data, mime: image.mime } : {}) });
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
