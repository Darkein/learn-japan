// Couche TTS légère :
//  - speakWord : lecture d'un mot ou d'une phrase via la Web Speech API du navigateur
//    (offline, zéro quota, contenu arbitraire) — démarre SYNCHRONEMENT dans le geste
//    utilisateur, donc audible partout, mobile compris. Réservé au dico et aux exercices.
//  - splitSentences : segmentation des tokens analysés en phrases (index global conservé),
//    utilisée par le lecteur audio unifié (lib/storyPodcast.ts).
//
// La lecture continue d'un article/podcast (Cloud TTS + surlignage) vit dans le moteur
// lib/segmentPlayer.ts, piloté par ui/usePodcastPlayer.tsx.

import { nudgeAudioFocusRelease, primeAudioFocus } from "./audioFocus";
import type { AnnotatedToken } from "./furigana";

// ---------- Web Speech : lecture d'un mot ------------------------------------

const JA_LANG = "ja-JP";

function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Choisit une voix japonaise si le navigateur en propose une (sinon, défaut système). */
function pickJaVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith("ja")) ?? null;
}

/**
 * Lit un mot (ou une courte chaîne) en japonais via la Web Speech API. La promesse se
 * résout à la FIN de l'énoncé (ou tout de suite si la synthèse n'est pas supportée), afin
 * que l'appelant puisse afficher un état « lecture en cours » sur toute la durée réelle.
 */
export function speakWord(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSupported() || !text.trim()) return resolve();
    primeAudioFocus(); // pendant le geste : déverrouille le nudge de fin de lecture
    window.speechSynthesis.cancel(); // coupe toute lecture en cours
    const u = new SpeechSynthesisUtterance(text);
    u.lang = JA_LANG;
    const v = pickJaVoice();
    if (v) u.voice = v;
    const done = () => {
      nudgeAudioFocusRelease();
      resolve();
    };
    u.onend = done;
    u.onerror = done; // utterance interrompue/échouée : même libération
    window.speechSynthesis.speak(u);
  });
}

/** Coupe la lecture de phrase/mot en cours (voix du navigateur). */
export function stopSentence(): void {
  if (!speechSupported()) return;
  // Nudge seulement si une synthèse tournait vraiment : stopSentence est aussi appelée
  // au démontage de chaque carte d'exercice et au début de chaque lecture.
  const speechActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
  window.speechSynthesis.cancel();
  if (speechActive) nudgeAudioFocusRelease();
}

// ---------- Segmentation en phrases ------------------------------------------

const SENTENCE_END = new Set(["。", "！", "？", "!", "?", "．", "\n"]);

export interface PlayerSentence {
  segments: string[]; // surfaces des tokens de la phrase
  baseIndex: number; // index GLOBAL du 1er token (pour le surlignage)
  text: string; // = segments.join("")
}

/**
 * Groupe les tokens analysés en phrases : on coupe APRÈS un token de ponctuation
 * finale. Chaque phrase conserve l'index global de ses tokens.
 */
export function splitSentences(tokens: AnnotatedToken[]): PlayerSentence[] {
  const out: PlayerSentence[] = [];
  let cur: string[] = [];
  let base = 0;
  tokens.forEach((tok, i) => {
    if (cur.length === 0) base = i;
    cur.push(tok.surface);
    const isEnd = [...tok.surface].some((ch) => SENTENCE_END.has(ch));
    if (isEnd) {
      out.push({ segments: cur, baseIndex: base, text: cur.join("") });
      cur = [];
    }
  });
  if (cur.length) out.push({ segments: cur, baseIndex: base, text: cur.join("") });
  return out.filter((s) => s.text.trim().length > 0);
}
