import { describe, expect, it } from "vitest";
import { buildSilentWavBlob } from "./silentWav";

describe("buildSilentWavBlob", () => {
  it("produit un blob audio/wav de la bonne taille (44 octets d'en-tête + 24 000 éch./s)", () => {
    const b = buildSilentWavBlob(8000);
    expect(b.type).toBe("audio/wav");
    expect(b.size).toBe(44 + 24000 * 8);
  });

  it("arrondit les durées non entières en échantillons (ex. 250 ms → 6000 échantillons)", () => {
    expect(buildSilentWavBlob(250).size).toBe(44 + 6000);
  });

  it("écrit un en-tête RIFF/WAVE 24 kHz (fréquence des MP3 Cloud TTS) et un payload 100 % silence", async () => {
    const bytes = new Uint8Array(await buildSilentWavBlob(1000).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const str = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(36 + 24000); // taille RIFF
    expect(view.getUint32(24, true)).toBe(24000); // sample rate — DOIT rester celui des MP3 Cloud TTS
    expect(view.getUint32(40, true)).toBe(24000); // taille data
    expect(bytes.slice(44).every((v) => v === 128)).toBe(true);
  });
});
