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
      <div className="sticky top-0 z-20 -mx-4 flex items-center gap-4 border-b border-hairline bg-bg px-4 py-3">
        <button
          className="cursor-pointer py-1 font-sans text-sm tracking-wide text-muted transition-colors hover:text-text"
          onClick={onBack}
        >
          ← Retour
        </button>
        {title && <span className="min-w-0 flex-1 truncate font-serif text-lg text-text">{title}</span>}
        <div ref={setSlotEl} className="flex shrink-0 items-center gap-2" />
        {showGear && (
          <button
            className="cursor-pointer px-1 text-xl leading-none text-muted hover:text-text"
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
