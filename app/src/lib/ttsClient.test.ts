import { afterEach, describe, expect, it, vi } from "vitest";

// Cache TTS mocké : on isole le comportement réseau (IndexedDB indisponible en env node).
vi.mock("./db", () => ({
  getTtsCache: vi.fn(async () => undefined),
  putTtsCache: vi.fn(async () => undefined),
}));

import { synthesizeSentence, synthesizeText, TtsUnconfiguredError, TtsUnreachableError } from "./ttsClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ttsClient — repli hors-ligne", () => {
  it("mappe un échec réseau (mode avion) sur TtsUnreachableError", async () => {
    // fetch rejette comme en mode avion (« Failed to fetch »).
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(synthesizeText("こんにちは", "ja")).rejects.toBeInstanceOf(TtsUnreachableError);
    await expect(synthesizeSentence(["こんにちは"], 0)).rejects.toBeInstanceOf(TtsUnreachableError);
  });

  it("mappe un timeout (AbortError) sur TtsUnreachableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    await expect(synthesizeText("test", "fr")).rejects.toBeInstanceOf(TtsUnreachableError);
  });

  it("garde TtsUnconfiguredError distinct (HTTP 503) pour le repli en ligne", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );
    await expect(synthesizeText("test", "ja")).rejects.toBeInstanceOf(TtsUnconfiguredError);
  });
});
