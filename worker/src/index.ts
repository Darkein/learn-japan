// Worker de génération — détenteur de la clé Gemini, porte d'auth.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et reçoit le texte.
//
// Génération SYNCHRONE : pour une courte histoire, Gemini répond en quelques secondes,
// bien dans les limites d'un Worker. Pas de KV ni de R2 → rien à provisionner.
// (Le stockage audio R2 reviendra avec le mode voiture / TTS en Phase 3.)

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
  REQUIRE_ACCESS: string;
}

interface GenerateRequest {
  kind?: "story";
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
  const parts = [
    "Écris une courte histoire en japonais adaptée à un apprenant.",
    r.level ? `Niveau JLPT visé : N${r.level}.` : "",
    r.theme ? `Thème : ${r.theme}.` : "",
    r.kanji?.length ? `Mets en avant ces kanji : ${r.kanji.join(" ")}.` : "",
    r.grammar?.length ? `Illustre ces points de grammaire : ${r.grammar.join(", ")}.` : "",
    r.prompt ? `Consigne : ${r.prompt}.` : "",
    "Réponds uniquement avec le texte japonais (pas de furigana, pas de traduction).",
  ];
  return parts.filter(Boolean).join("\n");
}

async function callGemini(env: Env, prompt: string): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    // Pas de clé → réponse stub (le squelette reste testable hors-ligne).
    return `【stub】${prompt.slice(0, 40)}… (configurer GEMINI_API_KEY)`;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) throw new Error("Réponse Gemini vide");
  return text.trim();
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
        const text = await callGemini(env, buildPrompt(body));
        return json({ text });
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }

    if (url.pathname === "/") return json({ ok: true, service: "learn-japan-gen" });
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
