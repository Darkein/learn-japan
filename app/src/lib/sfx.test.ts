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

  // Les deux réglages « sans le son » choisissent le CONTENU des révisions (écoute ou
  // écrit) : ils n'ont pas leur mot à dire sur un « juste / raté » de 0,7 s.
  it("reste actif en mode « Sans le son » permanent", () => {
    expect(sfxEnabled({ ...base, silentReviews: true })).toBe(true);
  });

  it("reste actif pendant une pause d'écoute (« Je ne peux pas écouter »)", () => {
    const silentUntil = Date.now() + SILENT_PAUSE_MS;
    expect(sfxEnabled({ ...base, silentUntil })).toBe(true);
  });

  it("ne dépend que de son propre réglage", () => {
    expect(
      sfxEnabled({
        ...base,
        feedbackSounds: false,
        silentReviews: false,
        silentUntil: 0,
      }),
    ).toBe(false);
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
