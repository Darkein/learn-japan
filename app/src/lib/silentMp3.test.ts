import { describe, expect, it } from "vitest";
import { SILENT_FRAME_MS, silentFrame, silentMp3Bytes } from "./silentMp3";

describe("silentFrame", () => {
  it("est une trame MPEG-2 Layer III 24 kHz mono autonome de 120 octets", () => {
    const f = silentFrame();
    expect(f.length).toBe(120);
    // Synchro + version/couche : 0xFF 0xF3 = MPEG-2, Layer III, sans CRC.
    expect(f[0]).toBe(0xff);
    expect(f[1]).toBe(0xf3);
    // Octet 3 : débit 40 kbps (index 5), fréquence 24 kHz (index 1), sans padding.
    expect((f[2] >> 4) & 15).toBe(5);
    expect((f[2] >> 2) & 3).toBe(1);
    // Mono (bits de mode 11) et main_data_begin = 0 : aucune dépendance au réservoir
    // de bits, la trame reste valide répétée ou appondue après n'importe quel clip.
    expect((f[3] >> 6) & 3).toBe(3);
    expect(f[4]).toBe(0);
  });
});

describe("silentMp3Bytes", () => {
  it("répète la trame pour couvrir au moins la durée demandée", () => {
    const f = silentFrame();
    expect(silentMp3Bytes(1000).length).toBe(Math.ceil(1000 / SILENT_FRAME_MS) * f.length);
    expect(silentMp3Bytes(SILENT_FRAME_MS).length).toBe(f.length);
    expect(silentMp3Bytes(SILENT_FRAME_MS + 1).length).toBe(2 * f.length);
    expect(silentMp3Bytes(0).length).toBe(f.length); // jamais vide
  });

  it("chaque répétition est la trame elle-même", () => {
    const f = silentFrame();
    const out = silentMp3Bytes(3 * SILENT_FRAME_MS);
    for (let i = 0; i < 3; i++) expect(out.slice(i * f.length, (i + 1) * f.length)).toEqual(f);
  });
});
