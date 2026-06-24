// Worker de génération — détenteur des clés (Gemini), porte d'auth, magasin de statut.
// Le client public (PWA) n'a JAMAIS de clé : il poste une requête ici et poll /status/:id.
// Protection : Cloudflare Access devant le Worker (login email gratuit) + REQUIRE_ACCESS.
//
// Phase 0 : squelette fonctionnel. Le pipeline complet (furigana déterministes côté client,
// TTS, assemblage de pack, R2) s'étoffe en Phases 1–3.

export interface Env {
  STATUS: KVNamespace;
  AUDIO: R2Bucket;
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

type Status =
  | { state: "queued" }
  | { state: "generating" }
  | { state: "ready"; text: string }
  | { state: "error"; message: string };

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
    // Pas de clé en dev → réponse stub (le squelette reste testable hors-ligne).
    return `【stub】${prompt.slice(0, 40)}… (configurer GEMINI_API_KEY)`;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!accessOk(req, env)) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);

    // GET /status/:id
    const statusMatch = url.pathname.match(/^\/status\/([\w-]+)$/);
    if (req.method === "GET" && statusMatch) {
      const raw = await env.STATUS.get(statusMatch[1]);
      return json(raw ? JSON.parse(raw) : { state: "unknown" });
    }

    // POST /generate
    if (req.method === "POST" && url.pathname === "/generate") {
      const body = (await req.json().catch(() => ({}))) as GenerateRequest;
      const id = crypto.randomUUID();
      const set = (s: Status) =>
        env.STATUS.put(id, JSON.stringify(s), { expirationTtl: 60 * 60 * 24 });
      await set({ state: "queued" });

      // Génération en tâche de fond ; le client poll /status/:id.
      ctx.waitUntil(
        (async () => {
          try {
            await set({ state: "generating" });
            const text = await callGemini(env, buildPrompt(body));
            await set({ state: "ready", text });
          } catch (e) {
            await set({ state: "error", message: String(e) });
          }
        })(),
      );

      return json({ id }, 202);
    }

    if (url.pathname === "/") return json({ ok: true, service: "learn-japan-gen" });
    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
