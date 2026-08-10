import { describe, expect, it } from "vitest";
import { urlB64ToUint8Array } from "./push";

describe("urlB64ToUint8Array", () => {
  it("décode le base64url sans padding (forme des clés VAPID)", () => {
    // "Bonjour" en base64 classique est "Qm9uam91cg==" ; base64url le sert sans "=".
    expect([...urlB64ToUint8Array("Qm9uam91cg")]).toEqual([...new TextEncoder().encode("Bonjour")]);
  });

  it("traduit les caractères propres à l'URL (- et _)", () => {
    // 0xFA 0xFB 0xFC 0xFD → "+vv8/Q==" en base64, "-vv8_Q" en base64url.
    expect([...urlB64ToUint8Array("-vv8_Q")]).toEqual([0xfa, 0xfb, 0xfc, 0xfd]);
  });

  it("rend bien 65 octets pour une clé publique P-256 non compressée", () => {
    // Point non compressé : 0x04 || x(32) || y(32), soit 87 caractères base64url.
    const key = `BA${"A".repeat(85)}`;
    const bytes = urlB64ToUint8Array(key);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });
});
