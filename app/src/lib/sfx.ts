// Sons de retour des exercices : juste, raté, série terminée.
//
// Trois MP3 courts (17 à 41 Ko), embarqués dans le bundle et précachés par le service
// worker : disponibles hors-ligne comme le reste de l'app, sans le moindre appel réseau à
// l'usage. Ils sont FABRIQUÉS par `npm run data:sfx` (scripts/build-sfx.mts) — la synthèse
// vit au build, pas ici ; ce module ne fait que décoder et jouer.
//
// Lecture via Web Audio (et non un <audio>) : un tampon décodé une fois se rejoue sans
// latence ni nouvelle demande de focus audio à l'OS — le lecteur de médias, lui, rouvre
// une session à chaque play et peut faire baisser le volume système sur Android (cf. le
// contournement de lib/audioFocus.ts).

import successUrl from "../assets/sfx/success.mp3";
import errorUrl from "../assets/sfx/error.mp3";
import completeUrl from "../assets/sfx/complete.mp3";
import { loadSettings, type AppSettings } from "./settings";

export type SfxKind = "success" | "error" | "complete";

const FILES: Record<SfxKind, string> = {
  success: successUrl,
  error: errorUrl,
  complete: completeUrl,
};

/** Volume de lecture : les fichiers sont encodés à −3 dBFS, ceci les remet à leur place
 *  — présents sans couvrir la synthèse vocale ni la musique de l'utilisateur. */
const MASTER_GAIN = 0.4;

/**
 * Retour sonore actif ? Un seul réglage le commande, celui qui porte son nom.
 *
 * Ni « Sans le son » ni la pause « Je ne peux pas écouter » n'entrent ici, malgré leurs
 * noms : toutes deux disent « remplace les exercices d'ÉCOUTE par de l'écrit » — le
 * japonais parlé est inaudible ou incompris là, tout de suite. Un « juste / raté » de
 * 0,7 s n'est pas un exercice d'écoute. Les couper au passage rendait le réglage
 * « Sons de retour dans les exercices » menteur : coché, et pourtant muet.
 */
export function sfxEnabled(s: AppSettings): boolean {
  return s.feedbackSounds;
}

// ---------- Contexte audio (paresseux, partagé) -------------------------------

interface Bus {
  ac: AudioContext;
  out: GainNode;
}

let bus: Bus | null = null;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  // `typeof window` (et non `Window`) : les constructeurs globaux comme AudioContext sont
  // déclarés sur globalThis, pas sur l'interface Window — l'intersection les perdrait.
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Bus audio, créé au premier son (donc dans un geste utilisateur) puis réutilisé. */
function getBus(): Bus | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!bus) {
    try {
      const ac = new Ctor();
      const out = ac.createGain();
      out.gain.value = MASTER_GAIN;
      out.connect(ac.destination);
      bus = { ac, out };
    } catch {
      return null; // Web Audio indisponible (contexte bloqué, quota d'AudioContext…)
    }
  }
  // Onglet remis au premier plan, contexte suspendu par la politique d'autoplay : la
  // reprise ne peut réussir que dans un geste utilisateur — c'est le cas de tous nos sons.
  if (bus.ac.state === "suspended") void bus.ac.resume().catch(() => {});
  return bus;
}

// ---------- Chargement des fichiers ------------------------------------------

/** Octets des MP3, demandés une fois — avant même qu'un contexte audio existe. */
const bytes = new Map<SfxKind, Promise<ArrayBuffer | null>>();
/** Tampons décodés, prêts à rejouer indéfiniment. */
const decoded = new Map<SfxKind, AudioBuffer>();
const decoding = new Map<SfxKind, Promise<AudioBuffer | null>>();

function fetchBytes(kind: SfxKind): Promise<ArrayBuffer | null> {
  let p = bytes.get(kind);
  if (!p) {
    p = fetch(FILES[kind])
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null); // hors-ligne au tout premier usage : tant pis, pas de son
    bytes.set(kind, p);
  }
  return p;
}

function decode(kind: SfxKind, b: Bus): Promise<AudioBuffer | null> {
  let p = decoding.get(kind);
  if (!p) {
    p = fetchBytes(kind)
      // Copie : decodeAudioData DÉTACHE le tampon qu'on lui passe, et les octets servent
      // aussi de cache si un décodage doit être refait (contexte recréé).
      .then((raw) => (raw ? b.ac.decodeAudioData(raw.slice(0)) : null))
      .then((buf) => {
        if (buf) decoded.set(kind, buf);
        return buf;
      })
      .catch(() => null);
    decoding.set(kind, p);
  }
  return p;
}

/**
 * Amorce le téléchargement des trois sons. Appelé au chargement du module (donc quand
 * l'écran d'exercices arrive), bien avant le premier clic de réponse : le décodage du
 * moment venu part alors d'octets déjà en mémoire. Rien n'est téléchargé si le retour
 * sonore est coupé — inutile de payer 90 Ko pour du silence ; un réglage réactivé en
 * cours de route se rattrape au premier son (chargement à la demande).
 */
export function prefetchSfx(): void {
  if (typeof window === "undefined" || typeof fetch === "undefined") return;
  if (!sfxEnabled(loadSettings())) return;
  for (const kind of Object.keys(FILES) as SfxKind[]) void fetchBytes(kind);
}

prefetchSfx();

// ---------- Lecture ----------------------------------------------------------

/**
 * Silence de tête du décodeur : un MP3 sans en-tête gapless rend quelques dizaines de ms
 * de vide avant l'attaque (délai d'encodeur). On le mesure une fois par son et on démarre
 * la lecture après, sinon le retour semble détaché du clic.
 */
const leadIn = new Map<SfxKind, number>();

function findLeadIn(kind: SfxKind, buf: AudioBuffer): number {
  let v = leadIn.get(kind);
  if (v === undefined) {
    const data = buf.getChannelData(0);
    const limit = Math.min(data.length, Math.floor(buf.sampleRate * 0.1));
    v = 0;
    for (let i = 0; i < limit; i++) {
      if (Math.abs(data[i]) > 0.001) { v = i / buf.sampleRate; break; }
    }
    leadIn.set(kind, v);
  }
  return v;
}

function start(kind: SfxKind, b: Bus, buf: AudioBuffer): void {
  const src = b.ac.createBufferSource();
  src.buffer = buf;
  src.connect(b.out);
  src.start(0, findLeadIn(kind, buf));
  src.onended = () => src.disconnect();
}

/** Au-delà, un son arrivé en retard (premier décodage lent) ne commente plus rien. */
const LATE_MS = 800;

/**
 * Joue un son de retour, si le réglage l'autorise. Sans Web Audio, sans fichier joignable
 * ou sur décodage impossible, l'appel ne fait simplement rien : le son est un bonus,
 * jamais une dépendance. À appeler depuis un geste utilisateur (clic de réponse) — hors
 * geste, le navigateur garde le contexte suspendu.
 */
export function playSfx(kind: SfxKind, settings: AppSettings = loadSettings()): void {
  if (!sfxEnabled(settings)) return;
  const b = getBus();
  if (!b) return;
  const ready = decoded.get(kind);
  if (ready) return start(kind, b, ready);
  // Premier passage : décodage asynchrone, on joue dès qu'il est prêt — sauf s'il a
  // traîné au point que la réponse ne soit plus à l'écran.
  const asked = Date.now();
  void decode(kind, b).then((buf) => {
    if (buf && Date.now() - asked < LATE_MS) start(kind, b, buf);
  });
}
