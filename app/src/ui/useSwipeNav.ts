import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// Détection de balayage horizontal (swipe) pour naviguer vers la page voisine. Pointer Events
// natifs, comme le reste du codebase (cf. TokaidoStrip.tsx).
//
// Le conteneur porte `touch-action: pan-y` (classe Tailwind `touch-pan-y`, ajoutée par
// SwipeNavigator) : le défilement vertical reste natif, mais les gestes horizontaux nous sont
// livrés sans que le navigateur ne les « vole » pour scroller — sinon, sur tactile, un swipe
// horizontal se termine par un `pointercancel` et jamais un `pointerup`. On confirme donc sur
// `pointerup` ET `pointercancel`, à partir de la dernière position suivie via `pointermove`.

/** Distance horizontale minimale (px) pour valider un swipe. */
const THRESHOLD = 50;
/** Le geste doit être plus horizontal que vertical (rejette le scroll). */
const DOMINANCE = 1.2;

interface Options {
  onPrev?: () => void;
  onNext?: () => void;
}

interface Handlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

export function useSwipeNav({ onPrev, onNext }: Options): Handlers {
  const g = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);

  function commit() {
    const s = g.current;
    g.current = null;
    if (!s) return;
    const dx = s.lastX - s.x;
    const dy = s.lastY - s.y;
    if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
    // Balayage vers la gauche (dx < 0) = page suivante ; vers la droite = précédente.
    if (dx < 0) onNext?.();
    else onPrev?.();
  }

  return {
    onPointerDown(e) {
      g.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY };
    },
    onPointerMove(e) {
      if (g.current) {
        g.current.lastX = e.clientX;
        g.current.lastY = e.clientY;
      }
    },
    onPointerUp() {
      commit();
    },
    onPointerCancel() {
      commit();
    },
  };
}
