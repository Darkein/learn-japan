// Garde-fou « Too many subrequests » : une invocation de /generate ne doit JAMAIS
// dépasser le budget d'appels amont, même avec 10 clés toutes en 429 (crédits épuisés).
// On mocke `fetch` global pour compter les sous-requêtes réellement émises.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

// Env minimal : 10 clés Gemini, pas de cache R2 (bindings optionnels → génération à la volée).
function envWithKeys(n: number): Record<string, string> {
  const env: Record<string, string> = { GEMINI_MODEL: "gemini-2.5-flash", REQUIRE_ACCESS: "false" };
  for (let i = 1; i <= n; i++) env[i === 1 ? "GEMINI_API_KEY" : `GEMINI_API_KEY_${i}`] = `k${i}`;
  return env;
}

function storyReq() {
  return new Request("https://worker.test/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "story", level: 3, theme: "神社" }),
  });
}

const gemini429 = () =>
  new Response(JSON.stringify({ error: { code: 429, message: "prepayment credits depleted" } }), { status: 429 });

const geminiOk = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("bornage des sous-requêtes /generate", () => {
  it("plafonne les appels amont quand toutes les clés sont en 429", async () => {
    const fetchMock = vi.fn(async () => gemini429());
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), envWithKeys(10) as never);

    // Tout a échoué → 502, mais SANS avoir explosé le budget de sous-requêtes.
    expect(res.status).toBe(502);
    // MAX_TEXT_CALLS = 12. Un 429 n'est PAS réessayé (SERVER_TRANSIENT) → 1 fetch/tentative.
    // Aucun appel image (le texte a échoué avant). Marge confortable sous la limite (50) de Cloudflare.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("s'arrête au premier modèle qui répond (peu d'appels)", async () => {
    // Toutes les clés répondent OK : le premier essai suffit pour le texte. L'illustration
    // best-effort (même endpoint, réponse sans image) ajoute au plus MAX_IMAGE_CALLS appels.
    const fetchMock = vi.fn(async () => geminiOk("むかしむかし、ある神社に…"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), envWithKeys(10) as never);
    const body = (await res.json()) as { text?: string; cached?: boolean };

    expect(res.status).toBe(200);
    expect(body.text).toContain("神社");
    expect(body.cached).toBe(false);
    // 1 appel texte + au plus 2 appels image (MAX_IMAGE_CALLS) → jamais un balayage des 10 clés.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("bascule sur une autre clé/modèle si le premier essai est en 429", async () => {
    // Premier appel 429, puis succès : on doit obtenir le texte via le repli, sans crasher.
    let call = 0;
    const fetchMock = vi.fn(async () => (++call === 1 ? gemini429() : geminiOk("神社の物語")));
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), envWithKeys(10) as never);
    const body = (await res.json()) as { text?: string };

    expect(res.status).toBe(200);
    expect(body.text).toBe("神社の物語");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
