// Fabrique les trois sons de retour des exercices (app/src/assets/sfx/*.mp3) :
// réponse juste, réponse ratée, série terminée.
//
//   npm run data:sfx
//
// (Fichier `.mts` : l'encodeur lamejs n'existe qu'en ESM, et le dépôt n'est pas en
// `"type": "module"` — l'extension force tsx à charger ce script comme un module. Cet
// encodeur est sous LGPL et reste une dépendance de DÉVELOPPEMENT : il fabrique les MP3
// ici, il n'entre pas dans le bundle de l'app.)
//
// Les sons sont SYNTHÉTISÉS ici, à la construction, puis encodés en MP3 : l'app ne
// transporte que trois petits fichiers (lus par app/src/lib/sfx.ts), pas un moteur de
// synthèse. Le tirage aléatoire (bruit du bois, réverbération) passe par un PRNG à graine
// fixe : relancer le script réécrit des fichiers IDENTIQUES — un diff dans le dépôt
// signifie donc un vrai changement de son, jamais du bruit de build.
//
// La palette suit DESIGN.md — de la retenue, pas d'arcade :
//   - juste          → une cloche りん (deux frappes, quinte montante), claire et brève ;
//   - raté           → un claquement de bois 拍子木, sourd et grave, jamais un buzzer ;
//   - série terminée → trois cloches montantes en quartes/quintes, queue longue.
//
// Une cloche n'est pas une sinusoïde : ses partiels sont INHARMONIQUES (rapports non
// entiers) et s'éteignent d'autant plus vite qu'ils sont aigus — c'est ce qui sépare un
// « ding » de synthé d'un métal frappé, d'où la table BELL_PARTIALS. Le bois est une
// salve de bruit passée dans un passe-bande qui descend, posée sur un corps grave. Enfin
// une convolution avec une réponse impulsionnelle de petite pièce (bruit décroissant,
// canaux décorrélés) éloigne les sons de l'oreille au lieu de les y coller.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mp3Encoder } from "@breezystack/lamejs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "app", "src", "assets", "sfx");

const RATE = 44100;
const BITRATE = 192; // kbps, stéréo : la frappe du bois garde son mordant, ~30 Ko par son
/**
 * Niveau visé pour le son de RÉFÉRENCE (la cloche de réussite) : RMS de sa fenêtre de
 * 50 ms la plus forte. On ancre sur la sonie et non sur la crête, parce que la crête ne
 * dit rien de ce qu'on entend : à crête égale, adoucir une cloche (moins de partiels)
 * l'a rendue 2,5 dB PLUS forte, le signal devenant moins pointu. Cette valeur est celle
 * validée à l'oreille — la garder fixe protège le niveau des retouches de timbre.
 */
const TARGET_RMS = 0.27;
/** Fenêtre sur laquelle cette sonie est mesurée. */
const RMS_WINDOW = 0.05;
/** Plafond absolu d'un son (−2 dBFS), quel que soit son niveau relatif. */
const CEILING = 0.8;
/** Part de réverbération dans le mélange (le reste est direct). */
const WET = 0.2;
/** Attaque commune : ~3 ms, assez pour éviter le clic de départ, trop court pour s'entendre. */
const ATTACK = 0.003;
/** Plancher des rampes exponentielles (une exponentielle n'atteint jamais zéro). */
const FLOOR = 0.0001;

// ---------- Utilitaires ------------------------------------------------------

/** PRNG à graine (mulberry32) : sons reproductibles d'une machine à l'autre. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rampe exponentielle de `from` à `to` sur `dur` secondes, évaluée à `t` (comme Web Audio). */
function ramp(from: number, to: number, dur: number, t: number): number {
  const x = Math.min(Math.max(t / dur, 0), 1);
  return from * Math.pow(to / from, x);
}

/** Somme `value` dans `buf` à l'instant `t` (secondes), en ignorant ce qui déborde. */
function add(buf: Float64Array, t: number, value: number): void {
  const i = Math.round(t * RATE);
  if (i >= 0 && i < buf.length) buf[i] += value;
}

// ---------- Voix -------------------------------------------------------------

/**
 * Partiels d'une cloche frappée : rapports inharmoniques (relevés sur un りん), poids
 * décroissant, et extinction d'autant plus rapide que le partiel est aigu — c'est cette
 * dernière règle qui donne l'éclat de l'attaque puis le bourdon chaud de la queue.
 *
 * Trois partiels seulement, les aigus retenus : au-delà, la cloche devient un « ding »
 * de synthé, brillant et dur. Une frappe DOUCE, c'est peu de haut du spectre et une
 * attaque qui prend son temps (BELL_ATTACK).
 *
 * Aucun désaccord : une version précédente désaccordait les partiels de ±4 cents pour
 * « faire vivre » le métal. Ça s'entendait — mais comme un grésillement pulsé en fin de
 * son, le partiel 3 de la première cloche battant à ~19 Hz contre le partiel 2 de la
 * seconde. Deux cloches justes ne battent pas.
 */
const BELL_PARTIALS = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.01, gain: 0.26, decay: 0.6 },
  { ratio: 2.99, gain: 0.06, decay: 0.35 },
];

/** Attaque d'une cloche : 25 ms en cosinus surélevé (et non les 3 ms sèches du bois) —
 *  c'est ce temps de montée, plus que le timbre, qui sépare une frappe douce d'un choc. */
const BELL_ATTACK = 0.025;

/** Une frappe de cloche à `freq` Hz, `at` secondes après le début du son. */
function bell(buf: Float64Array, freq: number, at: number, gain: number, decay: number): void {
  for (const p of BELL_PARTIALS) {
    const f = freq * p.ratio;
    const peak = gain * p.gain;
    const end = decay * p.decay;
    const n = Math.ceil(end * RATE);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const env =
        t < BELL_ATTACK
          ? // Cosinus surélevé : pente nulle au départ ET à l'arrivée, donc pas de
            // « coup » au sommet de l'attaque comme en rampe exponentielle.
            peak * 0.5 * (1 - Math.cos((Math.PI * t) / BELL_ATTACK))
          : ramp(peak, FLOOR, end - BELL_ATTACK, t - BELL_ATTACK);
      add(buf, at + t, Math.sin(2 * Math.PI * f * t) * env);
    }
  }
}

/**
 * Claquement de bois : une salve de bruit filtrée (le « clac » du choc) sur un corps
 * qui descend (la masse du bloc). Sec et bref — un raté se signale, il ne se punit pas.
 *
 * Tout est calé dans le MÉDIUM (salve autour de 1,8 kHz, corps vers 300 Hz) : un
 * haut-parleur de téléphone ne descend pas sous ~400 Hz, et une première version posée
 * sur un corps à 196 Hz s'entendait 13 dB sous la cloche de réussite — présente à
 * l'oscilloscope, inaudible dans la main.
 */
function woodClack(buf: Float64Array, at: number, gain: number, rand: () => number): void {
  const burst = 0.09; // durée de la salve de bruit
  const n = Math.ceil(burst * RATE);
  // Passe-bande qui descend : au-dessus ça siffle, en dessous ça cogne — le bois est là.
  // Biquad RBJ recalculé à chaque échantillon puisque la fréquence balaye.
  const Q = 1.1;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const x = (rand() * 2 - 1) * (1 - i / n);
    const w0 = (2 * Math.PI * ramp(1900, 850, burst, t)) / RATE;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    const y =
      (alpha * x - alpha * x2 - -2 * Math.cos(w0) * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    add(buf, at + t, y * ramp(gain * 0.55, FLOOR, burst, t));
  }

  // Résonance du bloc : un bois frappé SONNE, brièvement, sur deux modes. C'est ce qui
  // porte le son sur un petit haut-parleur — le bruit seul, très « pointu » (crête haute,
  // énergie faible), s'entendait 5 dB sous la cloche à crête pourtant comparable.
  for (const [freq, peakGain, decay] of [
    [980, 0.85, 0.075],
    [1470, 0.32, 0.045],
  ]) {
    const n2 = Math.ceil(decay * RATE);
    for (let i = 0; i < n2; i++) {
      const t = i / RATE;
      const peak = gain * peakGain;
      const env =
        t < ATTACK ? ramp(FLOOR, peak, ATTACK, t) : ramp(peak, FLOOR, decay - ATTACK, t - ATTACK);
      add(buf, at + t, Math.sin(2 * Math.PI * freq * t) * env);
    }
  }

  const bodyEnd = 0.2;
  const bodyPeak = gain * 0.95;
  let phase = 0;
  for (let i = 0; i < Math.ceil(bodyEnd * RATE); i++) {
    const t = i / RATE;
    // Le corps descend d'un ton et demi : la masse du bloc, pas une note — mais assez
    // haut pour qu'un petit haut-parleur le rende.
    phase += (2 * Math.PI * ramp(340, 240, 0.16, Math.min(t, 0.16))) / RATE;
    const env =
      t < ATTACK
        ? ramp(FLOOR, bodyPeak, ATTACK, t)
        : ramp(bodyPeak, FLOOR, bodyEnd - ATTACK, t - ATTACK);
    add(buf, at + t, Math.sin(phase) * env);
  }
}

// ---------- Réverbération (convolution par FFT) ------------------------------

/** FFT complexe sur place, radix-2 itératif (taille = puissance de 2). */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Convolution rapide (domaine fréquentiel) — la convolution directe serait ~10^10 ops. */
function convolve(sig: Float64Array, ir: Float64Array): Float64Array {
  let n = 1;
  while (n < sig.length + ir.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n);
  const br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(sig); br.set(ir);
  fft(ar, ai, false);
  fft(br, bi, false);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    ai[i] = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
  }
  fft(ar, ai, true);
  return ar.subarray(0, sig.length + ir.length);
}

/**
 * Réponse impulsionnelle d'une petite pièce : bruit décroissant en puissance. Un tirage
 * par canal (queue large et non écho centré), donc deux IR distinctes.
 *
 * NORMALISÉE comme le fait le ConvolverNode du navigateur (`normalize = true`) : sans
 * cela, convoluer avec 60 000 échantillons de bruit d'amplitude 1 multiplie le niveau par
 * ~100 et la réverbération noie la frappe — le son monte au lieu d'attaquer. On reprend
 * la formule du spec Web Audio (calibration 0,00125 rapportée à 44,1 kHz, divisée par la
 * puissance efficace de l'IR) pour que le dosage WET veuille dire la même chose ici.
 */
const GAIN_CALIBRATION = 0.00125; // constante du spec Web Audio (ConvolverNode)
function impulse(seconds: number, decay: number, rand: () => number): Float64Array {
  const n = Math.floor(seconds * RATE);
  const ir = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    ir[i] = (rand() * 2 - 1) * Math.pow(1 - i / n, decay);
    energy += ir[i] * ir[i];
  }
  const power = Math.sqrt(energy / n) || 1;
  const scale = (GAIN_CALIBRATION * (44100 / RATE)) / power;
  for (let i = 0; i < n; i++) ir[i] *= scale;
  return ir;
}

// ---------- Sons -------------------------------------------------------------

// Hauteurs : quartes et quintes justes (pas de tierce), la couleur des gammes
// pentatoniques japonaises — juste sans être sucré.
const D5 = 587.33, A5 = 880, D6 = 1174.66, E6 = 1318.51;

interface Recipe {
  name: string;
  seconds: number; // durée de synthèse avant la queue de réverbération
  seed: number;
  render: (buf: Float64Array, rand: () => number) => void;
  /** Saturation douce (tanh) avant réverbération : arrondit les pointes du bruit, donc
   *  monte l'ÉNERGIE à crête égale. Sans elle, un claquement plafonne bien plus bas
   *  qu'une cloche de même crête — et s'entend d'autant moins. */
  drive?: number;
}

const RECIPES: Recipe[] = [
  {
    name: "success",
    seconds: 1.2,
    seed: 1,
    render: (b) => {
      bell(b, A5, 0, 0.62, 0.85);
      // Quinte au-dessus, la réponse « oui » : elle entre plus tard et en retrait, pour
      // se poser sur la première au lieu de la percuter.
      bell(b, E6, 0.11, 0.3, 0.9);
    },
  },
  {
    name: "error",
    seconds: 0.6,
    seed: 2,
    drive: 2.2,
    render: (b, rand) => {
      // DEUX frappes, comme un vrai 拍子木 (deux blocs qu'on claque l'un contre l'autre) :
      // 90 ms de bois isolées passent inaperçues à côté d'une cloche qui résonne une
      // seconde ; la reprise donne au raté la même présence sans le rendre agressif.
      woodClack(b, 0, 1.15, rand);
      woodClack(b, 0.115, 0.95, rand);
    },
  },
  {
    name: "complete",
    seconds: 3,
    seed: 3,
    render: (b) => {
      // Fin de série : trois frappes montantes, la dernière laissée résonner.
      bell(b, D5, 0, 0.56, 1.1);
      bell(b, A5, 0.16, 0.56, 1.3);
      bell(b, D6, 0.34, 0.52, 2.2);
    },
  },
];

/** Synthèse d'un son → canaux gauche/droit (direct mono + réverbération stéréo). */
function renderStereo(r: Recipe): [Float64Array, Float64Array] {
  const rand = rng(r.seed);
  const dry = new Float64Array(Math.ceil(r.seconds * RATE));
  r.render(dry, rand);
  if (r.drive) {
    const k = r.drive;
    for (let i = 0; i < dry.length; i++) dry[i] = Math.tanh(k * dry[i]) / Math.tanh(k);
  }
  const channels: Float64Array[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const wet = convolve(dry, impulse(1.4, 3.5, rand));
    const out = new Float64Array(wet.length);
    for (let i = 0; i < out.length; i++) out[i] = (i < dry.length ? dry[i] : 0) + wet[i] * WET;
    channels.push(out);
  }
  return [channels[0], channels[1]];
}

/**
 * Coupe la queue de réverbération 40 dB sous la crête du son, avec un fondu de 80 ms.
 * Au-delà on encode de l'inaudible — et surtout, un MP3 rend mal une queue tonale très
 * basse : le codec « gargouille » sur ce qu'il n'a presque plus de bits pour décrire, et
 * ça s'entend comme un petit grésillement de fin de son. Autant ne pas l'encoder.
 */
const TAIL_FADE = 0.08;
function trim(chs: Float64Array[]): number {
  let peak = 0;
  for (const ch of chs) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const floor = peak / 100; // −40 dB
  let last = 0;
  for (const ch of chs)
    for (let i = ch.length - 1; i > last; i--)
      if (Math.abs(ch[i]) > floor) { last = Math.max(last, i); break; }
  const n = Math.min(chs[0].length, last + Math.round(TAIL_FADE * RATE));
  const fade = Math.round(TAIL_FADE * RATE);
  for (const ch of chs)
    for (let i = Math.max(0, n - fade); i < n; i++) ch[i] *= (n - i) / fade;
  return n;
}

/** Encodage MP3 (stéréo, `BITRATE` kbps) d'un couple de canaux flottants. */
function encodeMp3(left: Float64Array, right: Float64Array, gain: number): Buffer {
  const enc = new Mp3Encoder(2, RATE, BITRATE);
  const chunk = 1152; // taille d'une trame MPEG1 Layer III
  const parts: Uint8Array[] = [];
  const l = new Int16Array(chunk), r = new Int16Array(chunk);
  for (let off = 0; off < left.length; off += chunk) {
    const n = Math.min(chunk, left.length - off);
    for (let i = 0; i < n; i++) {
      l[i] = Math.max(-32768, Math.min(32767, Math.round(left[off + i] * gain * 32767)));
      r[i] = Math.max(-32768, Math.min(32767, Math.round(right[off + i] * gain * 32767)));
    }
    const buf = enc.encodeBuffer(l.subarray(0, n), r.subarray(0, n));
    if (buf.length) parts.push(buf);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

// ---------- Programme --------------------------------------------------------

const rendered = RECIPES.map((r) => {
  const [left, right] = renderStereo(r);
  const n = trim([left, right]);
  return { recipe: r, left: left.subarray(0, n), right: right.subarray(0, n) };
});

// Échelle commune ANCRÉE sur la cloche de réussite : c'est elle qui fixe le niveau de
// référence de l'app, les autres sons gardent leur place relative autour. (Ancrer sur le
// plus fort des trois ferait baisser la réussite dès qu'un autre son gagne en présence.)
function peakOf(chs: Float64Array[]): number {
  let p = 0;
  for (const ch of chs) for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}
/** RMS de la fenêtre de `RMS_WINDOW` la plus forte — la sonie telle qu'on l'entend. */
function loudestRms(ch: Float64Array): number {
  const win = Math.round(RMS_WINDOW * RATE);
  let sum = 0;
  for (let i = 0; i < Math.min(win, ch.length); i++) sum += ch[i] * ch[i];
  let best = sum;
  for (let i = win; i < ch.length; i++) {
    sum += ch[i] * ch[i] - ch[i - win] * ch[i - win];
    if (sum > best) best = sum;
  }
  return Math.sqrt(best / win);
}
const reference = rendered.find((r) => r.recipe.name === "success")!;
const gain = TARGET_RMS / loudestRms(reference.left);

mkdirSync(OUT_DIR, { recursive: true });
for (const { recipe, left, right } of rendered) {
  // Garde-fou : un son plus dense que la référence ne doit pas frôler le plein niveau —
  // le décodeur MP3 dépasse un peu la valeur encodée et écrêterait.
  const safe = Math.min(gain, CEILING / peakOf([left, right]));
  const mp3 = encodeMp3(left, right, safe);
  const path = join(OUT_DIR, `${recipe.name}.mp3`);
  writeFileSync(path, mp3);
  let peak = 0;
  for (const v of left) peak = Math.max(peak, Math.abs(v) * safe);
  console.log(
    `${recipe.name.padEnd(9)} ${(left.length / RATE).toFixed(2)} s · ` +
      `crête ${peak.toFixed(3)} · ${(mp3.length / 1024).toFixed(1)} Ko → ${path}`,
  );
}
