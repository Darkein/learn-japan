import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStory } from "./genClient";

/** Réponse /generate mockée. */
function mockGenerate(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateStory — décodage de l'illustration", () => {
  it("décode l'image base64 en Blob typé quand le Worker en renvoie une", async () => {
    // "hello" en base64.
    mockGenerate({ text: "テキスト。", image: "aGVsbG8=", mime: "image/png" });
    const { text, image } = await generateStory({ level: 5 });
    expect(text).toBe("テキスト。");
    expect(image).toBeInstanceOf(Blob);
    expect(image!.type).toBe("image/png");
    expect(new TextDecoder().decode(await image!.arrayBuffer())).toBe("hello");
  });

  it("renvoie image undefined quand le Worker n'en fournit pas (best-effort)", async () => {
    mockGenerate({ text: "テキスト。" });
    const { text, image } = await generateStory({ level: 5 });
    expect(text).toBe("テキスト。");
    expect(image).toBeUndefined();
  });

  it("trim le texte renvoyé", async () => {
    mockGenerate({ text: "  テキスト。  \n" });
    const { text } = await generateStory({ level: 5 });
    expect(text).toBe("テキスト。");
  });
});
