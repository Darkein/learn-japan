// Tiroir à glissement partagé (liste des pistes du player, fiches mot/kanji) : la poignée
// se tire vers le haut pour ouvrir / plein écran, vers le bas pour refermer, et le geste
// se poursuit depuis la zone scrollable quand elle est en butée (continuité scroll ↔ tiroir).

import { useEffect, useRef, useState } from "react";

export type SheetState = "closed" | "open" | "full";

interface Options {
  /** Hauteur (px) du point d'ancrage courant — 0 quand fermé. */
  snapH: number;
  /** Hauteur du point d'ancrage « ouvert ». */
  openH: number;
  /** Hauteur du point d'ancrage « plein écran ». */
  fullH: number;
  /** Zone scrollable interne : le geste tactile y pilote le tiroir quand elle est en butée. */
  scrollEl: HTMLElement | null;
  /** Résolution du point d'ancrage au relâchement. */
  onSnap: (s: SheetState) => void;
  /** Tap sur la poignée sans déplacement. */
  onTap: () => void;
}

export function useDragSheet({ snapH, openH, fullH, scrollEl, onSnap, onTap }: Options) {
  // Hauteur du tiroir pendant un glissement (null = calée sur le point d'ancrage).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);
  // Géométrie et callbacks courants lus par l'écouteur tactile (évite les closures périmées).
  const envRef = useRef({ snapH, openH, fullH, onSnap, onTap });
  envRef.current = { snapH, openH, fullH, onSnap, onTap };

  // Résolution du point d'ancrage au relâchement : plus tolérante qu'un simple « plus proche »
  // — dès qu'on tire franchement vers le haut la liste s'ouvre, et un long glissement va au
  // plein écran ; sous un petit seuil elle se referme.
  function resolve(h: number): SheetState {
    const { openH: o, fullH: f } = envRef.current;
    if (h < 72) return "closed";
    if (h > (o + f) / 2) return "full";
    return "open";
  }

  // Continuité scroll ↔ tiroir : quand la zone est scrollée à fond (en haut et qu'on tire vers
  // le bas, ou en bas et qu'on tire vers le haut), le geste pilote la hauteur du panneau comme
  // la poignée. On écoute le tactile en non-passif pour pouvoir couper le rebond natif au bon
  // moment ; ailleurs, le scroll de la zone reste intact.
  useEffect(() => {
    const el = scrollEl;
    if (!el) return;
    let startY = 0;
    let cap = false; // le geste pilote le tiroir
    let capStartY = 0;
    let capStartH = 0;
    let lastH = 0;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      cap = false;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const { snapH: curH, fullH: f } = envRef.current;
      if (!cap) {
        const dy = startY - y; // vers le haut > 0
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((atTop && dy < -2) || (atBottom && dy > 2 && curH < f - 1)) {
          cap = true;
          capStartY = y;
          capStartH = curH;
        } else {
          return; // laisse le scroll natif de la zone
        }
      }
      e.preventDefault(); // coupe le rebond et pilote le tiroir
      lastH = Math.min(envRef.current.fullH, Math.max(0, capStartH + (capStartY - y)));
      setDragHeight(lastH);
    };
    const onEnd = () => {
      if (!cap) return;
      cap = false;
      envRef.current.onSnap(resolve(lastH));
      setDragHeight(null);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollEl]);

  // Glissement de la poignée. Un simple tap (sans déplacement) déclenche `onTap`.
  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startH: snapH, moved: false };
    setDragHeight(snapH);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    setDragHeight(Math.min(fullH, Math.max(0, d.startH + dy)));
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) onTap();
    else onSnap(resolve(dragHeight ?? d.startH));
    setDragHeight(null);
  }

  return {
    /** Hauteur courante du tiroir (glissement en cours, sinon point d'ancrage). */
    sheetH: dragHeight != null ? dragHeight : snapH,
    /** Glissement en cours → couper les transitions CSS pour suivre le doigt. */
    dragging: dragHeight != null,
    /** À étaler sur l'élément poignée. */
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    /** Annule un glissement en cours (fermeture par le fond pendant un drag). */
    cancelDrag: () => setDragHeight(null),
  };
}
