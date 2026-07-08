// Garde-fou « Too many subrequests » + parcours Together : une invocation de /generate
// ne doit JAMAIS dépasser le budget d'appels amont, et doit parler le format OpenAI de
// Together. On mocke `fetch` global pour compter/piloter les sous-requêtes.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index";

// Env minimal : une clé Together, pas de cache R2 (bindings optionnels → génération à la volée).
const env = { TOGETHER_API_KEY: "tk", REQUIRE_ACCESS: "false" } as never;

function storyReq() {
  return new Request("https://worker.test/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "story", level: 3, theme: "神社" }),
  });
}

// Réponses au format OpenAI/Together (chat/completions).
const together429 = () =>
  new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });

const togetherOk = (text: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }), { status: 200 });

// Images Together : /images/generations. Ici toujours en échec → l'histoire passe sans image.
const isImageCall = (url: unknown) => typeof url === "string" && url.includes("/images/generations");

afterEach(() => vi.unstubAllGlobals());

describe("/generate via Together", () => {
  it("plafonne les appels amont quand tout est en 429", async () => {
    const fetchMock = vi.fn(async () => together429());
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), env);

    // Tout a échoué → 502, sans exploser le budget de sous-requêtes (MAX_TEXT_CALLS = 12).
    expect(res.status).toBe(502);
    // 429 non réessayé (SERVER_TRANSIENT) → 1 fetch/tentative ; texte échoué ⇒ pas d'appel image.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("renvoie le texte au format OpenAI et tape le bon endpoint avec Bearer", async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      isImageCall(url) ? together429() : togetherOk("むかしむかし、ある神社に…"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), env);
    const body = (await res.json()) as { text?: string; cached?: boolean };

    expect(res.status).toBe(200);
    expect(body.text).toContain("神社");
    expect(body.cached).toBe(false);

    // Premier appel = chat/completions Together, clé en Authorization: Bearer.
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstUrl).toBe("https://api.together.xyz/v1/chat/completions");
    expect((firstInit.headers as Record<string, string>).Authorization).toBe("Bearer tk");
  });

  it("rapatrie l'illustration quand Together renvoie une URL (pas du base64)", async () => {
    const png = new Uint8Array([137, 80, 78, 71]); // en-tête PNG factice
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isImageCall(url)) {
        return new Response(JSON.stringify({ data: [{ url: "https://img.test/x.png" }] }), { status: 200 });
      }
      if (url === "https://img.test/x.png") {
        return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
      }
      return togetherOk("神社の物語"); // chat/completions
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), env);
    const body = (await res.json()) as { text?: string; image?: string; mime?: string };

    expect(res.status).toBe(200);
    expect(body.image).toBe(btoa(String.fromCharCode(...png)));
    expect(body.mime).toBe("image/png");
  });

  it("bascule sur le modèle suivant si le premier est en 429", async () => {
    let textCall = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isImageCall(url)) return together429();
      return ++textCall === 1 ? together429() : togetherOk("神社の物語");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), env);
    const body = (await res.json()) as { text?: string };

    expect(res.status).toBe(200);
    expect(body.text).toBe("神社の物語");
    expect(textCall).toBeGreaterThanOrEqual(2);
  });
});
