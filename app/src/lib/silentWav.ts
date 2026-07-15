// Génération de WAV QUASI-silencieux (PCM mono 24 kHz 16 bits) de durée arbitraire :
// une sinusoïde 50 Hz à ~-58 dBFS — inaudible à l'oreille (et irreproduisible par un
// haut-parleur de téléphone), mais AU-DESSUS du seuil d'audibilité de Chrome (~-72 dBFS).
// Un silence numérique parfait est classé « non audible » : écran éteint, la page est
// suspendue ~10 s plus tard et la chaîne de lecture meurt.
//
// 24 kHz = la fréquence EXACTE des MP3 Cloud TTS : WAV et segments partagent le même
// format de sortie, Android ne reconfigure jamais son pipeline audio à la frontière
// WAV → MP3 — une reconfiguration (ex-WAV 4 kHz) laissait les premiers clips MP3
// MUETS pendant quelques secondes au démarrage de la lecture. Sert :
//  - au « keeper » de focus audio (audioFocus.ts) — WAV ≥ 5 s pour un focus persistant ;
//  - au moteur podcast (segmentPlayer.ts) — blancs de quiz et silence de maintien joués
//    dans le MÊME <audio> que les segments, pour que l'OS voie un flux audible continu
//    et ne suspende jamais la page (les setTimeout y sont throttlés/gelés).

const SAMPLE_RATE = 24000;
/** Amplitude crête de la sinusoïde (16 bits signés) : 40/32768 ≈ -58 dBFS. */
const AMPLITUDE = 40;
const TONE_HZ = 50;

/** WAV PCM mono 24 kHz 16 bits de `durationMs` millisecondes de quasi-silence. */
export function buildSilentWavBlob(durationMs: number): Blob {
  const numSamples = Math.max(1, Math.round((SAMPLE_RATE * durationMs) / 1000));
  const headerSize = 44;
  const dataSize = numSamples * 2;
  const bytes = new Uint8Array(headerSize + dataSize);
  const view = new DataView(bytes.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate (16 bits/échantillon, mono)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits par échantillon
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  const step = (2 * Math.PI * TONE_HZ) / SAMPLE_RATE;
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(headerSize + i * 2, Math.round(AMPLITUDE * Math.sin(step * i)), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

// Object URLs mémoïsées par durée : le moteur ne manipule que 3-4 durées distinctes
// (blancs de quiz + silence de maintien), jamais révoquées. Création paresseuse pour
// rester importable en environnement node (vitest) sans URL.createObjectURL.
const urls = new Map<number, string>();

/** Object URL (mémoïsée) d'un WAV quasi-silencieux de `durationMs` millisecondes. */
export function silentWavUrl(durationMs: number): string {
  let u = urls.get(durationMs);
  if (!u) {
    u = URL.createObjectURL(buildSilentWavBlob(durationMs));
    urls.set(durationMs, u);
  }
  return u;
}
