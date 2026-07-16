// Génération de WAV silencieux (PCM mono 24 kHz 8 bits) de durée arbitraire, pour le
// « keeper » de focus audio (audioFocus.ts) — WAV ≥ 5 s pour un focus persistant.
//
// 24 kHz = la fréquence EXACTE des MP3 Cloud TTS : le pipeline audio n'est jamais
// reconfiguré entre le keeper et le lecteur — une reconfiguration (ex-WAV 4 kHz)
// laissait les premiers clips MP3 MUETS pendant quelques secondes au démarrage.
// Les silences DANS le flux du lecteur, eux, sont du MP3 (cf. silentMp3.ts).

const SAMPLE_RATE = 24000;

/** WAV PCM mono 24 kHz 8 bits de `durationMs` millisecondes de silence. */
export function buildSilentWavBlob(durationMs: number): Blob {
  const numSamples = Math.max(1, Math.round((SAMPLE_RATE * durationMs) / 1000));
  const headerSize = 44;
  const bytes = new Uint8Array(headerSize + numSamples);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true); // byte rate (8 bits/échantillon, mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits par échantillon
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);
  bytes.fill(128, headerSize); // silence (point milieu d'un PCM 8 bits non signé)
  return new Blob([bytes], { type: "audio/wav" });
}

// Object URLs mémoïsées par durée : le moteur ne manipule que 3-4 durées distinctes
// (blancs de quiz + silence de maintien), jamais révoquées. Création paresseuse pour
// rester importable en environnement node (vitest) sans URL.createObjectURL.
const urls = new Map<number, string>();

/** Object URL (mémoïsée) d'un WAV silencieux de `durationMs` millisecondes. */
export function silentWavUrl(durationMs: number): string {
  let u = urls.get(durationMs);
  if (!u) {
    u = URL.createObjectURL(buildSilentWavBlob(durationMs));
    urls.set(durationMs, u);
  }
  return u;
}
