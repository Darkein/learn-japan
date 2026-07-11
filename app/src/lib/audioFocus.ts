// Contournement d'un bug connu de Chrome/Android : après une synthèse vocale
// (`speechSynthesis`), le focus audio système n'est pas toujours abandonné, ce qui laisse
// le volume média du téléphone durablement bas ("ducking") — jusqu'à la fermeture du
// navigateur, ou jusqu'à ce qu'une autre appli fasse une NOUVELLE demande de focus média
// (type YouTube) qui déloge la demande orpheline et pousse Android à restaurer le volume.
//
// On imite donc cette nouvelle demande avec un <audio> qui joue un silence :
//  - contenu 100 % silencieux mais VOLUME PLEIN : Chromium ne demande le focus audio OS
//    que pour un lecteur « audible » (volume > 0, non muted) — à volume 0, il ne touche
//    jamais au focus et le nudge ne fait rien ;
//  - durée du fichier ≥ 5 s : en dessous, Chromium classe le média « transient » et ne
//    demande qu'un focus fugace au lieu du GAIN complet qu'une vraie lecture demande ;
//  - élément SINGLETON amorcé pendant un geste utilisateur : un play() audible hors geste
//    est refusé par la politique d'autoplay, sauf sur un élément ayant déjà joué via un
//    geste (verrou par élément) — or le nudge part d'un `onend` d'utterance, hors geste ;
//  - double impulsion (immédiate + différée) : Chrome n'abandonne le focus que quelques
//    secondes après l'arrêt d'une lecture ; une impulsion trop proche de la précédente
//    retombe dans la même session de focus et ne produit pas de nouvelle demande OS.

import { silentWavUrl } from "./silentWav";

// Élément persistant : conserve le « verrou geste » de l'autoplay entre les lectures.
let keeper: HTMLAudioElement | null = null;

function getKeeper(): HTMLAudioElement {
  if (!keeper) {
    // WAV de 8 s de silence : ≥ 5 s → focus « persistant » côté Chromium.
    keeper = new Audio(silentWavUrl(8000));
    keeper.preload = "auto";
  }
  return keeper;
}

/** Joue le silence `holdMs` millisecondes puis coupe (cycle demande/abandon de focus). */
function pulse(holdMs: number): void {
  try {
    const k = getKeeper();
    k.currentTime = 0;
    void k
      .play()
      .then(() => {
        setTimeout(() => k.pause(), holdMs);
      })
      .catch(() => {
        /* autoplay refusé (élément pas encore amorcé par un geste) — tant pis */
      });
  } catch {
    /* ignore */
  }
}

/**
 * À appeler pendant le geste utilisateur qui déclenche une synthèse vocale : déverrouille
 * l'élément pour l'autoplay (afin que le nudge de fin de lecture, hors geste, soit
 * autorisé) et fait un premier cycle de focus qui peut déjà déloger un duck résiduel.
 */
export function primeAudioFocus(): void {
  pulse(150);
}

/**
 * À appeler quand une synthèse vocale se termine ou est coupée : nouvelle demande de
 * focus média audible (comme le ferait YouTube) qui déloge la demande orpheline du moteur
 * TTS, puis abandon propre — Android restaure alors le volume ducké. Deux impulsions :
 * l'immédiate suffit si Chrome avait déjà abandonné son focus, la différée couvre le
 * délai de grâce interne de Chrome après une lecture récente.
 */
export function nudgeAudioFocusRelease(): void {
  pulse(600);
  setTimeout(() => pulse(600), 3000);
}
