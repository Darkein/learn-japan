// Sons de retour des exercices : juste, raté, série terminée.
//
// Tout est SYNTHÉTISÉ à la volée (Web Audio) plutôt que servi par des fichiers : pas
// d'octets binaires dans le dépôt, rien à télécharger ni à mettre en cache pour le
// service worker, et donc un retour sonore disponible hors ligne comme le reste de l'app.
// La synthèse additive donne aussi un timbre propre, sans compression ni souffle.
//
// La palette suit DESIGN.md — de la retenue, pas d'arcade :
//   - juste          → une cloche りん (deux frappes, quinte montante), claire et brève ;
//   - raté           → un claquement de bois 拍子木, sourd et grave, jamais un buzzer ;
//   - série terminée → trois cloches montantes en quartes/quintes, queue longue.
//
// Une cloche n'est pas une sinusoïde : ses partiels sont INHARMONIQUES (rapports non
// entiers) et s'éteignent d'autant plus vite qu'ils sont aigus. C'est ce qui sépare un
// « ding » de synthé d'un métal frappé, d'où la table BELL_PARTIALS ci-dessous. Une courte
// réverbération (réponse impulsionnelle générée, elle aussi) pose les sons dans une pièce
// au lieu de les coller à l'oreille.

import { isSilentMode, loadSettings, type AppSettings } from "./settings";

export type SfxKind = "success" | "error" | "complete";

/** Volume général : présent sans couvrir la synthèse vocale ni la musique de l'utilisateur. */
const MASTER_GAIN = 0.28;
/** Part de réverbération dans le mélange (le reste est direct). */
const WET_GAIN = 0.2;
/** Attaque commune : ~3 ms, assez pour éviter le clic de départ, trop court pour s'entendre. */
const ATTACK = 0.003;

/**
 * Retour sonore actif ? Le réglage le commande, mais la pause d'écoute (« Je ne peux pas
 * écouter », transports ou réunion) le coupe aussi : elle dit qu'AUCUN son ne doit sortir
 * du téléphone maintenant, pas seulement les phrases japonaises.
 */
export function sfxEnabled(s: AppSettings, now: Date = new Date()): boolean {
  return s.feedbackSounds && !isSilentMode(s, now);
}

// ---------- Contexte audio (paresseux, partagé) -------------------------------

interface Bus {
  ac: AudioContext;
  /** Entrée des voix : mélange direct + réverbération, puis volume général. */
  input: GainNode;
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

/**
 * Réponse impulsionnelle d'une petite pièce : bruit décroissant en puissance, stéréo
 * décorrélée (chaque canal son propre bruit) pour une queue large, et non un écho centré.
 */
function buildImpulse(ac: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Bus audio, créé au premier son (donc dans un geste utilisateur) puis réutilisé. */
function getBus(): Bus | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (!bus) {
    try {
      const ac = new Ctor();
      const master = ac.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ac.destination);

      const input = ac.createGain();
      input.connect(master); // voie directe

      const convolver = ac.createConvolver();
      convolver.buffer = buildImpulse(ac, 1.4, 3.5);
      const wet = ac.createGain();
      wet.gain.value = WET_GAIN;
      input.connect(convolver);
      convolver.connect(wet);
      wet.connect(master); // voie réverbérée

      bus = { ac, input };
    } catch {
      return null; // Web Audio indisponible (contexte bloqué, quota d'AudioContext…)
    }
  }
  // Onglet remis au premier plan, contexte suspendu par la politique d'autoplay : la
  // reprise ne peut réussir que dans un geste utilisateur — c'est le cas de tous nos sons.
  if (bus.ac.state === "suspended") void bus.ac.resume().catch(() => {});
  return bus;
}

// ---------- Voix -------------------------------------------------------------

/**
 * Partiels d'une cloche frappée : rapports inharmoniques (relevés sur un りん), poids
 * décroissant, et extinction d'autant plus rapide que le partiel est aigu — c'est cette
 * dernière règle qui donne l'éclat de l'attaque puis le bourdon chaud de la queue.
 */
const BELL_PARTIALS: { ratio: number; gain: number; decay: number }[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.01, gain: 0.46, decay: 0.66 },
  { ratio: 2.99, gain: 0.26, decay: 0.46 },
  { ratio: 4.18, gain: 0.13, decay: 0.3 },
  { ratio: 5.43, gain: 0.07, decay: 0.2 },
];

/** Une frappe de cloche à `freq` Hz, `at` secondes après maintenant. */
function bell(b: Bus, freq: number, at: number, gain: number, decay: number): void {
  const { ac, input } = b;
  const t0 = ac.currentTime + at;
  for (const p of BELL_PARTIALS) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * p.ratio;
    // Léger désaccord des partiels aigus : deux battements très lents, le métal « vit »
    // au lieu de sonner comme un orgue parfaitement juste.
    if (p.ratio > 1) osc.detune.value = (p.ratio % 2 === 0 ? 1 : -1) * 4;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * p.gain, t0 + ATTACK);
    const stop = t0 + decay * p.decay;
    g.gain.exponentialRampToValueAtTime(0.0001, stop);

    osc.connect(g);
    g.connect(input);
    osc.start(t0);
    osc.stop(stop + 0.02);
    osc.onended = () => g.disconnect();
  }
}

/**
 * Claquement de bois : une salve de bruit filtrée (le « clac » du choc) sur un corps
 * grave qui descend (la masse du bloc). Sec et sourd — un raté se signale, il ne se
 * punit pas.
 */
function woodClack(b: Bus, at: number, gain: number): void {
  const { ac, input } = b;
  const t0 = ac.currentTime + at;
  const noiseMs = 0.09;

  const len = Math.max(1, Math.floor(ac.sampleRate * noiseMs));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = ac.createBufferSource();
  noise.buffer = buf;

  // Passe-bande médium : au-dessus ça siffle, en dessous ça cogne — le bois est là.
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(1100, t0);
  band.frequency.exponentialRampToValueAtTime(520, t0 + noiseMs);
  band.Q.value = 1.1;

  const ng = ac.createGain();
  ng.gain.setValueAtTime(gain, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + noiseMs);
  noise.connect(band);
  band.connect(ng);
  ng.connect(input);
  noise.start(t0);
  noise.stop(t0 + noiseMs);
  noise.onended = () => ng.disconnect();

  const body = ac.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(196, t0); // sol grave, sous la voix
  body.frequency.exponentialRampToValueAtTime(138, t0 + 0.18);
  const bg = ac.createGain();
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(gain * 0.7, t0 + ATTACK);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  body.connect(bg);
  bg.connect(input);
  body.start(t0);
  body.stop(t0 + 0.24);
  body.onended = () => bg.disconnect();
}

// ---------- Sons ------------------------------------------------------------

// Hauteurs : quartes et quintes justes (pas de tierce), la couleur des gammes
// pentatoniques japonaises — juste sans être sucré.
const A5 = 880;
const E6 = 1318.51;
const D5 = 587.33;
const D6 = 1174.66;

function render(kind: SfxKind, b: Bus): void {
  if (kind === "success") {
    bell(b, A5, 0, 0.6, 1.3);
    bell(b, E6, 0.085, 0.42, 1.5); // quinte au-dessus : la réponse « oui »
  } else if (kind === "error") {
    // Plus fort que les cloches à l'oscilloscope, pas à l'oreille : 90 ms de bois se
    // perçoivent bien plus bas qu'un métal qui résonne une seconde.
    woodClack(b, 0, 0.75);
  } else {
    // Fin de série : trois frappes montantes, la dernière laissée résonner.
    bell(b, D5, 0, 0.5, 1.1);
    bell(b, A5, 0.16, 0.5, 1.3);
    bell(b, D6, 0.34, 0.46, 2.2);
  }
}

/**
 * Joue un son de retour, si le réglage l'autorise. Sans Web Audio (ou contexte refusé),
 * l'appel ne fait simplement rien : le son est un bonus, jamais une dépendance.
 * À appeler depuis un geste utilisateur (clic de réponse) — hors geste, le navigateur
 * garde le contexte suspendu.
 */
export function playSfx(kind: SfxKind, settings: AppSettings = loadSettings()): void {
  if (!sfxEnabled(settings)) return;
  const b = getBus();
  if (!b) return;
  try {
    render(kind, b);
  } catch {
    /* nœud refusé (contexte fermé entre-temps) : silence, rien de plus */
  }
}
