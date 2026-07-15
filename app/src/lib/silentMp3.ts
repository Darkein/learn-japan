// Silence MP3 de durée arbitraire pour le flux continu du lecteur (segmentPlayer.ts).
//
// Le moteur appond tout — segments TTS, blancs de quiz, tampon d'attente — dans un MÊME
// SourceBuffer `audio/mpeg` : le silence doit donc être du MP3, au format EXACT des
// segments Cloud TTS (MPEG-2 Layer III, 24 kHz, mono) pour que le pipeline audio ne soit
// jamais reconfiguré en cours de flux (cf. l'antécédent WAV 4 kHz → clips muets dans
// silentWav.ts, qui reste utilisé par le keeper de focus d'audioFocus.ts).
//
// La trame ci-dessous a été encodée avec LAME (40 kbps — seul débit bas dont la fréquence
// de sortie auto reste 24 kHz) puis vérifiée : autonome (main_data_begin = 0, aucune
// dépendance au réservoir de bits), donc répétable et concaténable après n'importe quel
// clip TTS sans artefact. 576 échantillons à 24 kHz = 24 ms par trame.

/** Durée d'une trame (ms) : granularité des silences générés. */
export const SILENT_FRAME_MS = 24;

// 120 octets : en-tête MPEG-2 Layer III 40 kbps 24 kHz mono + info latérale et données
// nulles (le remplissage « LAME… » est de la donnée ancillaire, ignorée au décodage).
const FRAME_B64 =
  "//NUxAAAAANIAAAAAExBTUUDAAkIAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let frame: Uint8Array | null = null;

/** La trame silencieuse unitaire (24 ms), décodée une seule fois. */
export function silentFrame(): Uint8Array {
  if (!frame) {
    const bin = atob(FRAME_B64);
    frame = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) frame[i] = bin.charCodeAt(i);
  }
  return frame;
}

/** Flux MP3 d'au moins `durationMs` de silence (arrondi à la trame supérieure, min. 1). */
export function silentMp3Bytes(durationMs: number): Uint8Array {
  const f = silentFrame();
  const n = Math.max(1, Math.ceil(durationMs / SILENT_FRAME_MS));
  const out = new Uint8Array(f.length * n);
  for (let i = 0; i < n; i++) out.set(f, i * f.length);
  return out;
}
