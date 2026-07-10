import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Détection de balayage horizontal (swipe) pour naviguer vers la page voisine, avec suivi
// « en direct » de l'avancement du geste (pour un retour visuel façon back-swipe iOS/Android).
// Pointer Events natifs, comme le reste du codebase (cf. TokaidoStrip.tsx).
//
// Le conteneur porte `touch-action: pan-y` (classe Tailwind `touch-pan-y`, ajoutée par
// SwipeNavigator) : le défilement vertical reste natif, mais les gestes horizontaux nous sont
// livrés sans être « volés » par le navigateur — sinon, sur tactile, un swipe horizontal se
// termine par un `pointercancel` et jamais un `pointerup`. On confirme donc sur `pointerup`
// ET `pointercancel`, à partir de la dernière position suivie via `pointermove`.

/** Distance horizontale (px) qui déclenche la navigation (et où l'indicateur est « armé »). */
const THRESHOLD = 70;
/** Le geste doit être plus horizontal que vertical (rejette le scroll). */
const DOMINANCE = 1.2;
/** Petit débattement initial avant de qualifier le geste d'horizontal (évite les faux positifs). */
const START_SLOP = 8;

interface Options {
  onPrev?: () => void;
  onNext?: () => void;
}

export interface SwipeDrag {
  /** -1 = vers la précédente (doigt vers la droite) ; 1 = vers la suivante (doigt vers la gauche) ; 0 = inactif. */
  dir: -1 | 0 | 1;
  /** Avancement 0→1 vers le seuil de déclenchement. */
  progress: number;
}

interface Tracker {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  horizontal: boolean;
}

const IDLE: SwipeDrag = { dir: 0, progress: 0 };

export function useSwipeNav({ onPrev, onNext }: Options): {
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
  drag: SwipeDrag;
} {
  const g = useRef<Tracker | null>(null);
  const [drag, setDrag] = useState<SwipeDrag>(IDLE);

  function idle() {
    setDrag((d) => (d.dir === 0 ? d : IDLE));
  }

  function commit() {
    const s = g.current;
    g.current = null;
    setDrag(IDLE);
    if (!s) return;
    const dx = s.lastX - s.x;
    const dy = s.lastY - s.y;
    if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
    // Balayage vers la gauche (dx < 0) = page suivante ; vers la droite = précédente.
    if (dx < 0) onNext?.();
    else onPrev?.();
  }

  return {
    handlers: {
      onPointerDown(e) {
        g.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, horizontal: false };
      },
      onPointerMove(e) {
        const s = g.current;
        if (!s) return;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.horizontal) {
          if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
          if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) {
            // Geste vertical (scroll) : on cesse de suivre, pas d'indicateur.
            g.current = null;
            idle();
            return;
          }
          s.horizontal = true;
        }
        const dir: -1 | 1 = dx < 0 ? 1 : -1;
        // Pas de voisin dans cette direction (extrémité) : aucun indicateur, geste inopérant.
        if (dir === 1 ? !onNext : !onPrev) {
          idle();
          return;
        }
        setDrag({ dir, progress: Math.min(1, Math.abs(dx) / THRESHOLD) });
      },
      onPointerUp() {
        commit();
      },
      onPointerCancel() {
        commit();
      },
    },
    drag,
  };
}
