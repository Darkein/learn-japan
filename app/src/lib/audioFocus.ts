// Contournement d'un bug connu de Chrome/Android : après une synthèse vocale
// (`speechSynthesis`), le focus audio système n'est pas toujours abandonné, ce qui laisse
// le volume média du téléphone durablement bas ("ducking") — jusqu'à la fermeture du
// navigateur, ou jusqu'à ce qu'une autre appli avec une VRAIE lecture média (type YouTube)
// vienne reprendre le focus de force. Un AudioContext vide ne suffit pas : Chromium ne le
// traite comme une session audio réelle que s'il y a un <audio>/<video> qui joue
// effectivement du son. On imite donc une brève lecture <audio> silencieuse puis on la
// coupe, pour forcer Chromium à redemander puis relâcher explicitement le focus audio OS.

/** Construit une fois un WAV mono 8 kHz de 50 ms de silence, encodé en data URI. */
function buildSilentWavDataUri(): string {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * 0.05);
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
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate (8 bits/échantillon, mono)
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits par échantillon
  writeStr(36, "data");
  view.setUint32(40, numSamples, true);
  bytes.fill(128, headerSize); // silence (point milieu d'un PCM 8 bits non signé)
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let silentAudioUri: string | null = null;
function getSilentAudioUri(): string {
  return silentAudioUri ?? (silentAudioUri = buildSilentWavDataUri());
}

/**
 * Force Chromium à redemander puis relâcher le focus audio OS, en jouant puis coupant
 * aussitôt un <audio> silencieux. Pas de garantie absolue (bug plateforme), mais imite ce
 * qu'une vraie lecture média (qui, elle, relâche correctement le focus) ferait.
 */
export function nudgeAudioFocusRelease(): void {
  try {
    const audio = new Audio(getSilentAudioUri());
    audio.volume = 0;
    const cleanup = () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    void audio
      .play()
      .then(() => setTimeout(cleanup, 80))
      .catch(cleanup);
  } catch {
    /* ignore */
  }
}
