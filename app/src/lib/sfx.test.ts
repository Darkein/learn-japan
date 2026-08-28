import { describe, expect, it } from "vitest";
import { loadSettings, SILENT_PAUSE_MS, type AppSettings } from "./settings";
import { playSfx, prefetchSfx, sfxEnabled } from "./sfx";

const base: AppSettings = loadSettings(); // valeurs par défaut (pas de localStorage en node)

describe("sfxEnabled", () => {
  it("est actif par défaut", () => {
    expect(base.feedbackSounds).toBe(true);
    expect(sfxEnabled(base)).toBe(true);
  });

  it("suit le réglage", () => {
    expect(sfxEnabled({ ...base, feedbackSounds: false })).toBe(false);
  });

  it("se tait pendant une pause d'écoute (« Je ne peux pas écouter »)", () => {
    const now = new Date("2025-01-01T10:00:00Z");
    const silentUntil = now.getTime() + SILENT_PAUSE_MS;
    expect(sfxEnabled({ ...base, silentUntil }, now)).toBe(false);
    // …et redevient actif une fois la pause expirée.
    expect(sfxEnabled({ ...base, silentUntil }, new Date(silentUntil + 1))).toBe(true);
  });

  it("se tait en mode sans le son", () => {
    expect(sfxEnabled({ ...base, silentReviews: true })).toBe(false);
  });
});

describe("playSfx", () => {
  // Hors navigateur (ici) : ni fetch des MP3, ni contexte audio — le son est un bonus,
  // son absence ne doit jamais casser l'appelant.
  it("ne fait rien (sans lever) quand Web Audio est absent", () => {
    expect(() => prefetchSfx()).not.toThrow();
    expect(() => playSfx("success", base)).not.toThrow();
    expect(() => playSfx("error", base)).not.toThrow();
    expect(() => playSfx("complete", base)).not.toThrow();
  });
});
