import { describe, expect, it } from "vitest";
import { buildSilentWavBlob } from "./silentWav";

describe("buildSilentWavBlob", () => {
  it("produit un blob audio/wav de la bonne taille (44 octets d'en-tête + 4000 éch./s × 2 octets)", () => {
    const b = buildSilentWavBlob(8000);
    expect(b.type).toBe("audio/wav");
    expect(b.size).toBe(44 + 4000 * 8 * 2);
  });

  it("arrondit les durées non entières en échantillons (ex. 250 ms → 1000 échantillons)", () => {
    expect(buildSilentWavBlob(250).size).toBe(44 + 1000 * 2);
  });

  it("écrit un en-tête RIFF/WAVE cohérent et un payload quasi-silencieux mais PAS nul", async () => {
    const bytes = new Uint8Array(await buildSilentWavBlob(1000).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const str = (o: number, n: number) => String.fromCharCode(...bytes.slice(o, o + n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(36 + 4000 * 2); // taille RIFF
    expect(view.getUint32(24, true)).toBe(4000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits par échantillon
    expect(view.getUint32(40, true)).toBe(4000 * 2); // taille data

    // Signal non nul (sinon Chrome classe l'onglet « non audible » → page suspendue
    // écran éteint), mais d'amplitude infime (inaudible à l'oreille : ≤ -58 dBFS).
    let maxAbs = 0;
    let nonZero = 0;
    for (let i = 44; i < bytes.length; i += 2) {
      const v = Math.abs(view.getInt16(i, true));
      if (v > 0) nonZero++;
      if (v > maxAbs) maxAbs = v;
    }
    expect(nonZero).toBeGreaterThan(0);
    expect(maxAbs).toBeGreaterThan(0);
    expect(maxAbs).toBeLessThanOrEqual(40);
  });
});
