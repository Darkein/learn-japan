// Proxy de récupération d'articles (onglet Articles) : le client ne peut pas fetch une
// page tierce depuis le navigateur (CORS), le Worker le fait à sa place et renvoie les
// OCTETS BRUTS (Content-Type passthrough : le décodage charset — Shift_JIS, EUC-JP… —
// se fait côté navigateur via TextDecoder). Volontairement PAS un proxy générique :
// HTML seulement, cap de taille, timeout, redirections re-validées, jamais de cache.
//
// SSRF : toute URL à IP littérale (v4 ou v6) est refusée — plus strict que la seule
// liste des plages privées, et suffisant : un article de presse a toujours un nom de
// domaine. Le parseur URL WHATWG normalise les formes décimales/hexadécimales
// (http://2130706433/ → 127.0.0.1), donc elles tombent aussi sous ce refus.
// Limite documentée : pas de résolution DNS possible dans un Worker, le rebinding DNS
// ne peut donc pas être totalement exclu ; l'egress part de l'edge Cloudflare, pas d'un
// réseau privé.

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

type JsonFn = (body: unknown, status?: number, headers?: Record<string, string>) => Response;

/** Valide une URL candidate. Retourne l'URL parsée ou un message d'erreur (FR, affichable). */
export function validateArticleUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "URL invalide." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Seuls les liens http(s) sont acceptés." };
  }
  if (url.username || url.password) {
    return { error: "URL avec identifiants refusée." };
  }
  if (url.port !== "") {
    return { error: "URL avec port explicite refusée." };
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { error: "Hôte interne refusé." };
  }
  if (host.startsWith("[")) {
    return { error: "Adresse IP littérale refusée." }; // IPv6
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { error: "Adresse IP littérale refusée." }; // IPv4 (formes normalisées par URL)
  }
  if (!host.includes(".")) {
    return { error: "Hôte invalide." }; // noms courts de réseau interne
  }
  return { url };
}

/**
 * Suit la chaîne de redirections manuellement (chaque saut re-validé), puis renvoie la
 * réponse finale et l'URL réellement servie.
 */
async function fetchWithValidatedRedirects(
  start: URL,
): Promise<{ res: Response; finalUrl: URL } | { error: string; status: number }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ja,en;q=0.5",
          "User-Agent": "learn-japan-article-fetcher/1.0",
        },
      });
    } catch {
      return { error: "Page injoignable (réseau ou délai dépassé).", status: 502 };
    }
    if (!REDIRECT_STATUS.has(res.status)) return { res, finalUrl: current };
    const location = res.headers.get("Location");
    if (!location) return { error: "Redirection sans destination.", status: 502 };
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { error: "Redirection invalide.", status: 502 };
    }
    const check = validateArticleUrl(next.toString());
    if ("error" in check) return { error: `Redirection refusée : ${check.error}`, status: 400 };
    current = check.url;
  }
  return { error: "Trop de redirections.", status: 502 };
}

/** POST /article/fetch — corps { url }. Renvoie les octets bruts de la page. */
export async function handleArticleFetch(
  req: Request,
  json: JsonFn,
  cors: Record<string, string>,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string") return json({ error: "Corps attendu : { url }." }, 400);
  const checked = validateArticleUrl(body.url.trim());
  if ("error" in checked) return json({ error: checked.error }, 400);

  const fetched = await fetchWithValidatedRedirects(checked.url);
  if ("error" in fetched) return json({ error: fetched.error }, fetched.status);
  const { res, finalUrl } = fetched;

  if (!res.ok) return json({ error: `La page a répondu HTTP ${res.status}.` }, 502);
  const contentType = res.headers.get("Content-Type") ?? "";
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime !== "text/html" && mime !== "application/xhtml+xml") {
    return json({ error: "Cette URL n'est pas une page HTML." }, 415);
  }

  // Lecture en streaming plafonnée : on n'accumule jamais plus de MAX_BYTES.
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return json({ error: "Page trop volumineuse (> 2 Mo)." }, 413);
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }

  return new Response(out, {
    status: 200,
    headers: {
      "Content-Type": contentType || "text/html",
      "X-Final-Url": finalUrl.toString(),
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}
