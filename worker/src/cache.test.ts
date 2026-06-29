import { describe, expect, it } from "vitest";
import { genCacheKey, lessonCacheKey, lessonStoryCacheKey, sha256Hex, ttsCacheKey } from "./cache";

describe("sha256Hex", () => {
  it("rend une empreinte hex de 64 caractères, déterministe", async () => {
    const a = await sha256Hex("bonjour");
    const b = await sha256Hex("bonjour");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("diffère pour des entrées différentes", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});

describe("genCacheKey", () => {
  it("préfixe par gen/<kind>/ et termine par .json", async () => {
    const key = await genCacheKey("lesson", "un prompt");
    expect(key).toMatch(/^gen\/lesson\/[0-9a-f]{64}\.json$/);
  });

  it("même (kind, prompt) ⇒ même clé ; prompt différent ⇒ clé différente", async () => {
    expect(await genCacheKey("story", "p")).toBe(await genCacheKey("story", "p"));
    expect(await genCacheKey("story", "p")).not.toBe(await genCacheKey("story", "q"));
  });
});

describe("lessonCacheKey", () => {
  it("format structuré gen/lesson/<id>.json", () => {
    expect(lessonCacheKey("n5-u1-l1")).toBe("gen/lesson/n5-u1-l1.json");
  });
});

describe("lessonStoryCacheKey", () => {
  it("format structuré gen/lesson-story/<id>/<variant>.json", () => {
    expect(lessonStoryCacheKey("n5-u1-l1", 1)).toBe("gen/lesson-story/n5-u1-l1/1.json");
    expect(lessonStoryCacheKey("n5-u1-l1", 2)).toBe("gen/lesson-story/n5-u1-l1/2.json");
  });

  it("deux variantes différentes ⇒ clés différentes", () => {
    expect(lessonStoryCacheKey("n5-u1-l1", 1)).not.toBe(lessonStoryCacheKey("n5-u1-l1", 2));
  });
});

describe("ttsCacheKey", () => {
  const base = { text: "こんにちは", voice: "ja-JP-Neural2-B", rate: 1, languageCode: "ja-JP" };

  it("préfixe par tts/ et est déterministe", async () => {
    const key = await ttsCacheKey(base);
    expect(key).toMatch(/^tts\/[0-9a-f]{64}\.json$/);
    expect(await ttsCacheKey(base)).toBe(key);
  });

  it("dépend de la voix et du débit", async () => {
    expect(await ttsCacheKey(base)).not.toBe(await ttsCacheKey({ ...base, voice: "ja-JP-Neural2-C" }));
    expect(await ttsCacheKey(base)).not.toBe(await ttsCacheKey({ ...base, rate: 1.2 }));
  });
});
