import { useRef, type PointerEvent as ReactPointerEvent } from "react";

// Détection de balayage horizontal (swipe) pour naviguer vers la page voisine. Pointer Events
// natifs, comme le reste du codebase (cf. TokaidoStrip.tsx). Volontairement SANS
// setPointerCapture ni touch-action restrictif : le contenu doit garder son défilement
// vertical natif ; on n'agit qu'au relâché, et seulement si le geste est franchement
// horizontal (sinon c'est un scroll vertical ou un simple tap).

/** Distance horizontale minimale (px) pour valider un swipe. */
const THRESHOLD = 60;
/** Le geste doit être nettement plus horizontal que vertical (rejette le scroll). */
const DOMINANCE = 1.5;

interface Options {
  onPrev?: () => void;
  onNext?: () => void;
}

interface Handlers {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onPointerCancel: () => void;
}

export function useSwipeNav({ onPrev, onNext }: Options): Handlers {
  const from = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown(e) {
      from.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp(e) {
      const start = from.current;
      from.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
      // Balayage vers la gauche (dx < 0) = page suivante ; vers la droite = précédente.
      if (dx < 0) onNext?.();
      else onPrev?.();
    },
    onPointerCancel() {
      from.current = null;
    },
  };
}
