import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useMediaQuery } from "./useMediaQuery";
import { IconArrowLeft, IconArrowRight } from "./kit/Icon";

// Carrousel latéral entre pages sœurs (leçon↔leçon, histoire↔histoire). Les deux pages
// glissent ENSEMBLE à la même vitesse (pas d'empilement) + léger fondu ; une seule voisine par
// geste (clamp à une largeur → pas de défilement multi-pages). Pointer Events natifs.
//
// Points clés :
// - La page courante vit TOUJOURS dans le même emplacement DOM (slot d'une piste flex), même
//   au repos : on ne bascule pas sa position au début du geste (sinon React la démonterait →
//   perte du scroll, ré-analyse, effets rejoués). Au repos : aucune transform (l'en-tête
//   `sticky` fonctionne normalement) ; la voisine n'est montée que pendant un geste actif.
// - `overflow-x: clip` isole le débordement horizontal (voisine hors écran) sans créer de
//   conteneur de défilement (le `sticky` vertical reste relatif au body).

const START_SLOP = 8; // px avant de qualifier le geste d'horizontal
const DOMINANCE = 1.2; // le geste doit être plus horizontal que vertical (sinon = scroll)
const COMMIT_FRACTION = 0.3; // part d'une largeur au-delà de laquelle on valide au relâché
const FLICK_VELOCITY = 0.4; // px/ms : un « flick » rapide valide même en deçà de la fraction
const SETTLE_MS = 220;
const SETTLE_EASE = "cubic-bezier(0.2, 0, 0.2, 1)";

interface Props {
  /** Change quand la page active change (id de route) → réinitialise l'état du carrousel. */
  currentKey: string;
  /** Page courante (déjà enveloppée dans son ReaderPage). */
  current: ReactNode;
  /** Navigation immédiate (flèches desktop + validation du geste). Absent = extrémité. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Fabrique la page voisine en aperçu (mode `preview`) ; absent si non préchargée / extrémité. */
  renderPrev?: () => ReactNode;
  renderNext?: () => ReactNode;
  labels: { prev: string; next: string };
  bottomOffset?: string;
}

const ARROW =
  "flex h-11 w-11 items-center justify-center rounded-full border border-hairline-strong " +
  "bg-surface/80 text-muted backdrop-blur-sm transition-colors hover:text-text hover:border-accent " +
  "cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted " +
  "disabled:hover:border-hairline-strong";

interface Slide {
  dir: -1 | 1; // 1 = suivante (voisine à droite) ; -1 = précédente (voisine à gauche)
  w: number; // largeur de la boîte au démarrage du geste
  offset: number; // translateX courant de la piste (px), dans [-w, 0]
  node: ReactNode; // page voisine en aperçu, créée une fois (identité stable)
  animating: boolean; // true pendant l'accroche (transition CSS)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function SlideStack({
  currentKey,
  current,
  onPrev,
  onNext,
  renderPrev,
  renderNext,
  labels,
  bottomOffset,
}: Props) {
  const clipRef = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [slide, setSlide] = useState<Slide | null>(null);
  // Navigation à exécuter à la fin de l'accroche (transitionend) ; null = simple retour.
  const commitGo = useRef<(() => void) | null>(null);
  const g = useRef<{
    x: number;
    y: number;
    w: number;
    dir: -1 | 0 | 1;
    horizontal: boolean;
    lastX: number;
    lastT: number;
    vx: number;
  } | null>(null);

  // La navigation a changé la page active → on repart d'un état propre (démonte la voisine).
  useEffect(() => {
    setSlide(null);
    g.current = null;
    commitGo.current = null;
  }, [currentKey]);

  function onPointerDown(e: ReactPointerEvent) {
    if (slide?.animating) return; // geste ignoré pendant l'accroche
    const el = clipRef.current;
    if (!el) return;
    g.current = {
      x: e.clientX,
      y: e.clientY,
      w: el.clientWidth,
      dir: 0,
      horizontal: false,
      lastX: e.clientX,
      lastT: performance.now(),
      vx: 0,
    };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const s = g.current;
    if (!s) return;
    const now = performance.now();
    const dt = now - s.lastT;
    if (dt > 0) s.vx = (e.clientX - s.lastX) / dt;
    s.lastX = e.clientX;
    s.lastT = now;

    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.horizontal) {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) {
        g.current = null; // geste vertical → on laisse le scroll natif
        return;
      }
      const dir: -1 | 1 = dx < 0 ? 1 : -1;
      const go = dir === 1 ? onNext : onPrev;
      const render = dir === 1 ? renderNext : renderPrev;
      if (!go || !render) {
        g.current = null; // pas de voisin (extrémité) ou pas encore préchargée
        return;
      }
      s.horizontal = true;
      s.dir = dir;
      if (!reduced) {
        setSlide({ dir, w: s.w, offset: dir === 1 ? 0 : -s.w, node: render(), animating: false });
      }
      return;
    }
    if (reduced || s.dir === 0) return;
    const base = s.dir === 1 ? 0 : -s.w;
    const offset = clamp(base + dx, -s.w, 0);
    setSlide((prev) => (prev ? { ...prev, offset, animating: false } : prev));
  }

  function endGesture() {
    const s = g.current;
    g.current = null;
    if (!s || !s.horizontal || s.dir === 0) return;
    const dir = s.dir;
    const go = dir === 1 ? onNext : onPrev;
    const dx = s.lastX - s.x;
    const p = dir === 1 ? clamp(-dx, 0, s.w) / s.w : clamp(dx, 0, s.w) / s.w;
    const flick = dir === 1 ? s.vx < -FLICK_VELOCITY : s.vx > FLICK_VELOCITY;
    const commit = p >= COMMIT_FRACTION || flick;

    if (reduced) {
      if (commit) go?.();
      return;
    }
    commitGo.current = commit ? (go ?? null) : null;
    setSlide((prev) =>
      prev
        ? { ...prev, animating: true, offset: commit ? (dir === 1 ? -prev.w : 0) : dir === 1 ? 0 : -prev.w }
        : prev,
    );
  }

  function onTrackTransitionEnd(e: { propertyName: string }) {
    if (e.propertyName !== "transform") return;
    const go = commitGo.current;
    commitGo.current = null;
    if (go) go(); // navigation → currentKey change → l'effet réinitialise le carrousel
    else setSlide(null); // retour : démonte la voisine
  }

  // Opacité de fondu selon l'avancement (page centrée = 1 ; page qui entre/sort ≈ 0.5→1).
  const p = slide ? clamp(slide.dir === 1 ? -slide.offset / slide.w : (slide.offset + slide.w) / slide.w, 0, 1) : 0;
  const currentOpacity = slide ? 1 - 0.5 * p : 1;
  const neighborOpacity = 0.5 + 0.5 * p;
  const settle = slide?.animating;

  return (
    <div
      className="relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {/* Flèches desktop uniquement (le tactile utilise le carrousel), groupées dans un coin. */}
      <div
        className="fixed right-4 z-30 hidden gap-2 min-[60rem]:flex"
        style={{ bottom: bottomOffset ?? "calc(var(--safe-b) + 1.5rem)" }}
      >
        <button className={ARROW} onClick={onPrev} disabled={!onPrev} aria-label={labels.prev} title={labels.prev}>
          <IconArrowLeft size={20} />
        </button>
        <button className={ARROW} onClick={onNext} disabled={!onNext} aria-label={labels.next} title={labels.next}>
          <IconArrowRight size={20} />
        </button>
      </div>

      <div ref={clipRef} className={`overflow-x-clip touch-pan-y ${slide ? "select-none" : ""}`}>
        <div
          className="flex"
          style={{
            transform: slide ? `translateX(${slide.offset}px)` : undefined,
            transition: settle ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : "none",
          }}
          onTransitionEnd={onTrackTransitionEnd}
        >
          <div
            className="w-full shrink-0"
            style={{ opacity: currentOpacity, transition: settle ? `opacity ${SETTLE_MS}ms ${SETTLE_EASE}` : "none" }}
          >
            {current}
          </div>
          {slide?.node && (
            <div
              className="w-full shrink-0"
              style={{
                order: slide.dir === -1 ? -1 : 0,
                opacity: neighborOpacity,
                transition: settle ? `opacity ${SETTLE_MS}ms ${SETTLE_EASE}` : "none",
              }}
            >
              {slide.node}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
