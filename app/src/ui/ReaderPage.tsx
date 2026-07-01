import { createContext, useState, type ReactNode } from "react";
import { useHashRoute } from "./useHashRoute";
import { useSettings } from "./useSettings";

interface Props {
  /** Titre optionnel affiché dans la barre supérieure (titre de la leçon / histoire). */
  title?: string;
  onBack: () => void;
  children?: ReactNode;
}

/** Slot DOM dans lequel les enfants peuvent porter des actions via createPortal. */
export const ReaderHeaderSlot = createContext<HTMLDivElement | null>(null);

/**
 * Page dédiée vers laquelle on navigue (lecture, révision) : remplace le shell à
 * onglets par une vue épurée avec une barre fine « ← Retour » + titre. Objectif :
 * navigation simple, page lisible (cf. DESIGN.md — filets, un seul accent).
 */
export function ReaderPage({ title, onBack, children }: Props) {
  const { openPanel } = useSettings();
  const route = useHashRoute();
  const showGear = route.kind !== "settings";
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  return (
    <ReaderHeaderSlot.Provider value={slotEl}>
      <div
        className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-bg px-4 py-1 sm:flex-nowrap"
        style={{ paddingTop: "calc(var(--safe-t) + 0.25rem)" }}
      >
        <button
          className="flex min-h-11 cursor-pointer items-center font-sans text-sm tracking-wide text-muted transition-colors hover:text-text"
          onClick={onBack}
        >
          ← Retour
        </button>
        {title && (
          <span className="order-first basis-full min-w-0 truncate text-center font-serif text-lg text-text sm:order-none sm:basis-auto sm:flex-1 sm:text-left">
            {title}
          </span>
        )}
        <div ref={setSlotEl} className="flex shrink-0 items-center gap-2 ml-auto sm:ml-0" />
        {showGear && (
          <button
            className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-xl leading-none text-muted hover:text-text"
            onClick={openPanel}
            aria-label="Paramètres"
          >
            ⚙
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-col">{children}</div>
    </ReaderHeaderSlot.Provider>
  );
}
