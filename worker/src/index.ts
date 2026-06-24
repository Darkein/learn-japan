// Worker de génération — détenteur de la clé Gemini, porte d'auth.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et reçoit le texte.
//
// Génération SYNCHRONE : pour une courte histoire, Gemini répond en quelques secondes,
// bien dans les limites d'un Worker. Pas de KV ni de R2 → rien à provisionner.
// (Le stockage audio R2 reviendra avec le mode voiture / TTS en Phase 3.)

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  // Chaîne de repli (JSON) : [{ provider, model, keyEnv }], du plus puissant au
  // plus léger. Optionnel — un défaut codé en dur prend le relais (resolveChain).
  MODEL_CHAIN?: string;
  REQUIRE_ACCESS: string;
}

interface GenerateRequest {
  kind?: "story" | "lesson";
  theme?: string;
  kanji?: string[];
  grammar?: string[];
  prompt?: string;
  level?: number;
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
  const models = [...new Set(["gemini-2.5-pro", primary, "gemini-2.0-flash", "gemini-2.5-flash-lite"])];
  return models.map((model) => ({ provider: "gemini", model, keyEnv: "GEMINI_API_KEY" }));
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

    if (url.pathname === "/") return json({ ok: true, service: "learn-japan-gen" });
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
