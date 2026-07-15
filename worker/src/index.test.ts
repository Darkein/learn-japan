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
    // Un seul modèle par défaut, 4 tentatives (MODEL_RETRY) ; texte échoué ⇒ pas d'appel image.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
  }, 15_000);

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

  it("réessaie le MÊME modèle sur 429 (limite dynamique) au lieu de dégrader", async () => {
    let textCall = 0;
    const textModels: string[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (isImageCall(url)) return together429();
      textModels.push((JSON.parse(String(init?.body)) as { model: string }).model);
      return ++textCall === 1 ? together429() : togetherOk("神社の物語");
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(storyReq(), env);
    const body = (await res.json()) as { text?: string };

    expect(res.status).toBe(200);
    expect(body.text).toBe("神社の物語");
    expect(textCall).toBeGreaterThanOrEqual(2);
    // Consistance de style : toutes les tentatives visent le même modèle.
    expect(new Set(textModels).size).toBe(1);
  });
});

// ---------- POST /tts ---------------------------------------------------------

const ttsEnv = { ...(env as Record<string, unknown>), GOOGLE_TTS_API_KEY: "gk" } as never;

function ttsReq(body: unknown) {
  return new Request("https://worker.test/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const googleOk = () => new Response(JSON.stringify({ audioContent: "bXAz" }), { status: 200 });

/** Corps JSON envoyé à Google lors du premier appel TTS mocké. */
function googlePayload(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("/tts en mode parts (SSML multi-voix)", () => {
  it("enveloppe les fragments d'une autre voix dans <voice>, sans timepoints", async () => {
    const fetchMock = vi.fn(async () => googleOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(
      ttsReq({
        parts: [
          { text: "La particule ", voice: "fr-FR-Neural2-A", languageCode: "fr-FR" },
          { text: "は", voice: "ja-JP-Neural2-B", languageCode: "ja-JP" },
          { text: " marque le thème.", voice: "fr-FR-Neural2-A", languageCode: "fr-FR" },
        ],
      }),
      ttsEnv,
    );
    const body = (await res.json()) as { audio?: string; marks?: unknown[] };

    expect(res.status).toBe(200);
    expect(body.audio).toBe("bXAz");
    expect(body.marks).toEqual([]);

    const payload = googlePayload(fetchMock);
    expect((payload.input as { ssml: string }).ssml).toBe(
      '<speak>La particule <voice name="ja-JP-Neural2-B">は</voice> marque le thème.</speak>',
    );
    // Voix requête = celle du PREMIER fragment ; pas de timepoints en mode parts.
    expect(payload.voice).toEqual({ languageCode: "fr-FR", name: "fr-FR-Neural2-A" });
    expect(payload.enableTimePointing).toBeUndefined();
  });

  it("échappe le XML des fragments", async () => {
    const fetchMock = vi.fn(async () => googleOk());
    vi.stubGlobal("fetch", fetchMock);

    await worker.fetch(
      ttsReq({ parts: [{ text: "a < b & c", voice: "fr-FR-Neural2-A", languageCode: "fr-FR" }] }),
      ttsEnv,
    );

    expect((googlePayload(fetchMock).input as { ssml: string }).ssml).toBe("<speak>a &lt; b &amp; c</speak>");
  });

  it("un seul fragment = SSML sans balise <voice> (voix requête suffit)", async () => {
    const fetchMock = vi.fn(async () => googleOk());
    vi.stubGlobal("fetch", fetchMock);

    await worker.fetch(ttsReq({ parts: [{ text: "こんにちは" }] }), ttsEnv);

    const payload = googlePayload(fetchMock);
    expect((payload.input as { ssml: string }).ssml).toBe("<speak>こんにちは</speak>");
    // Fragment sans voix ni langue → défauts japonais.
    expect(payload.voice).toEqual({ languageCode: "ja-JP", name: "ja-JP-Neural2-B" });
  });

  it("fragments tous vides → 502 « texte vide »", async () => {
    const fetchMock = vi.fn(async () => googleOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(ttsReq({ parts: [{ text: "  " }] }), ttsEnv);

    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clé TTS absente → 503 tts_unconfigured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => googleOk()));

    const res = await worker.fetch(ttsReq({ parts: [{ text: "猫" }] }), env);
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(503);
    expect(body.error).toBe("tts_unconfigured");
  });
});

describe("/tts en mode segments (timepoints)", () => {
  it("insère un <mark> par token et active enableTimePointing", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ audioContent: "bXAz", timepoints: [{ markName: "t1", timeSeconds: 0.5 }, { markName: "t0", timeSeconds: 0 }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(ttsReq({ segments: ["猫", "が", "いる"] }), ttsEnv);
    const body = (await res.json()) as { marks?: { i: number; t: number }[] };

    expect(res.status).toBe(200);
    // Marks triés par temps, index de token décodés depuis les noms de repère.
    expect(body.marks).toEqual([
      { i: 0, t: 0 },
      { i: 1, t: 0.5 },
    ]);

    const payload = googlePayload(fetchMock);
    expect((payload.input as { ssml: string }).ssml).toBe(
      '<speak><mark name="t0"/>猫<mark name="t1"/>が<mark name="t2"/>いる</speak>',
    );
    expect(payload.enableTimePointing).toEqual(["SSML_MARK"]);
  });
});
