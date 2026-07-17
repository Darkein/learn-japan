// Feuille basse draggable des fiches (mot, kanji) : même gestuelle que la liste des pistes
// du player (poignée, points d'ancrage ouvert/plein, continuité scroll ↔ tiroir — hook
// kit/useDragSheet), mais ancrée AU-DESSUS du player et de la nav du bas : on peut lire une
// fiche tout en gardant la barre de lecture visible et manœuvrable. Le fond assombri laisse
// donc le player et la nav cliquables (rendus après dans le DOM, à z égal ou supérieur).

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { BOTTOM_NAV_HEIGHT } from "./BottomNav";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { useHashRoute } from "./useHashRoute";
import { useMediaQuery } from "./useMediaQuery";
import { useDragSheet, type SheetState } from "./kit/useDragSheet";

// Hauteur (px) de la barre du bas (BOTTOM_NAV_HEIGHT = 3.5rem) — même valeur que le player.
const BOTTOM_NAV_PX = 56;

/** Valeur px d'une variable CSS du root (0 si absente). */
function cssPx(name: string): number {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isNaN(n) ? 0 : n;
}

export function BottomSheet({
  onClose,
  children,
  ariaLabel,
  resetKey,
}: {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** Changement de vue interne (mot ↔ kanji) : remet le scroll en haut. */
  resetKey?: string | null;
}) {
  const p = usePodcastPlayer();
  const route = useHashRoute();
  const wide = useMediaQuery("(min-width: 60rem)");

  // Monte fermée puis s'ancre « ouvert » : la hauteur (et le fond) transitionnent à l'entrée.
  const [snap, setSnap] = useState<SheetState>("closed");
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [contentH, setContentH] = useState(0);
  const [vh, setVh] = useState<number>(() => (typeof window !== "undefined" ? window.innerHeight : 800));

  useEffect(() => {
    setSnap("open");
  }, []);

  // Suit la hauteur de fenêtre (barres d'outils mobiles dynamiques) pour recalculer les ancrages.
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Escape ferme, et le scroll de la page derrière est gelé (mêmes précautions que kit/Sheet).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
    };
  }, [onClose]);

  // Hauteur naturelle du contenu : le point d'ancrage « ouvert » s'y cale (fiche courte →
  // feuille courte), plafonné à la moitié de l'écran.
  useLayoutEffect(() => {
    if (!contentEl || !scrollEl) return;
    // Mesure le wrapper interne (pas scrollHeight : gonflé par `h-full` quand la feuille
    // dépasse le contenu) + les rembourrages verticaux de la zone scrollable.
    const update = () => {
      const cs = getComputedStyle(scrollEl);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      setContentH(contentEl.offsetHeight + pad);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(contentEl);
    return () => ro.disconnect();
  }, [contentEl, scrollEl]);

  useEffect(() => {
    if (scrollEl) scrollEl.scrollTop = 0;
  }, [scrollEl, resetKey]);

  // La nav du bas n'apparaît qu'en mobile et sur les onglets principaux (même règle que le
  // player) ; la feuille se pose au-dessus de la nav ET du player quand ils sont là.
  const showBottomNav = !wide && !("from" in route);
  const navPx = showBottomNav ? BOTTOM_NAV_PX : 0;
  const playerPx = p.active ? cssPx("--player-h") : 0;
  const offsetPx = navPx + playerPx;

  // 48 = marge visuelle en haut (la poignée reste sous la barre d'état / l'encoche).
  const fullH = Math.max(0, vh - offsetPx - cssPx("--safe-t") - 48);
  const openH = Math.min(Math.max(contentH, 96), Math.round(vh * 0.5), fullH);
  const snapHeight = (s: SheetState) => (s === "full" ? fullH : s === "open" ? openH : 0);

  const { sheetH, dragging, handleProps, cancelDrag } = useDragSheet({
    snapH: snapHeight(snap),
    openH,
    fullH,
    scrollEl,
    onSnap: (s) => (s === "closed" ? onClose() : setSnap(s)),
    onTap: () => setSnap((s) => (s === "full" ? "open" : "full")),
  });
  // Fond proportionnel à l'ouverture (pleine intensité au point « ouvert »), comme le player.
  const backdropOpacity = openH > 0 ? Math.min(1, sheetH / openH) * 0.6 : 0;
  const ease = "cubic-bezier(0.2,0,0.2,1)";

  return (
    <>
      {/* Fond cliquable : scrim noir (foncé dans les deux thèmes). Rendu dans la page, donc
          SOUS la nav (z-40, après dans le DOM) et le player (z-50) : ils restent utilisables. */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        style={{
          backgroundColor: "#000",
          opacity: backdropOpacity,
          transition: dragging ? "none" : `opacity 200ms ${ease}`,
        }}
        onPointerDown={() => {
          cancelDrag();
          onClose();
        }}
      />

      <div
        className="fixed inset-x-0 z-40 flex justify-center"
        style={{ bottom: `calc(${showBottomNav ? BOTTOM_NAV_HEIGHT : "0px"} + var(--player-h, 0px))` }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          className="w-full max-w-[44rem] rounded-t-md border-t border-hairline bg-surface shadow-elev"
        >
          {/* Poignée — tirer vers le haut pour agrandir, vers le bas pour fermer ; un tap
              bascule ouvert/plein. `touch-none` : pas de pull-to-refresh pendant le geste. */}
          <div
            className="flex touch-none cursor-grab justify-center py-2 active:cursor-grabbing"
            {...handleProps}
            role="button"
            aria-label="Redimensionner la fiche (tirer en bas pour fermer)"
            title="Glisser pour redimensionner la fiche"
          >
            <span className="h-1.5 w-11 rounded-full bg-hairline-strong" />
          </div>
          {/* Contenu à hauteur animée, scrollable à l'intérieur. */}
          <div
            className="overflow-hidden"
            style={{ height: sheetH, transition: dragging ? "none" : `height 200ms ${ease}` }}
          >
            <div
              ref={setScrollEl}
              className="h-full overflow-y-auto overscroll-contain px-4"
              style={{ paddingBottom: offsetPx > 0 ? "1rem" : "calc(var(--safe-b) + 1rem)" }}
            >
              <div ref={setContentEl} className="flex flex-col gap-3 pt-1">
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
