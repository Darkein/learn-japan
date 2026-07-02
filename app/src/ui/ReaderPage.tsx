import { createContext, useState, type ReactNode } from "react";
import { useHashRoute } from "./useHashRoute";
import { useSettings } from "./useSettings";
import { Button } from "./kit/Button";
import { IconArrowLeft, IconGear } from "./kit/Icon";

interface Props {
  /** Titre optionnel affiché sous la barre supérieure (titre de la leçon / histoire). */
  title?: string;
  onBack: () => void;
  children?: ReactNode;
}

/** Slot DOM dans lequel les enfants peuvent porter des actions via createPortal. */
export const ReaderHeaderSlot = createContext<HTMLDivElement | null>(null);

/**
 * Page dédiée vers laquelle on navigue (lecture, révision) : remplace le shell à
 * onglets par une vue épurée. La barre sticky ne porte que la navigation (retour,
 * paramètres) ; le titre s'affiche en pleine largeur dessous (sans troncature), et
 * les actions contextuelles injectées via `ReaderHeaderSlot` se placent sous le
 * titre, à côté du contenu qu'elles concernent (cf. DESIGN.md — hiérarchie par la
 * typographie, un seul accent).
 */
export function ReaderPage({ title, onBack, children }: Props) {
  const { openPanel } = useSettings();
  const route = useHashRoute();
  const showGear = route.kind !== "settings";
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  return (
    <ReaderHeaderSlot.Provider value={slotEl}>
      <div
        className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-4 border-b border-hairline bg-bg px-4 py-1"
        style={{ paddingTop: "calc(var(--safe-t) + 0.25rem)" }}
      >
        <button
          className="flex min-h-11 cursor-pointer items-center gap-2 font-sans text-sm tracking-wide text-muted transition-colors hover:text-text"
          onClick={onBack}
        >
          <IconArrowLeft size={18} />
          Retour
        </button>
        {showGear && (
          <Button size="icon" variant="quiet" onClick={openPanel} aria-label="Paramètres">
            <IconGear />
          </Button>
        )}
      </div>
      {title && (
        <h1 className="mt-4 font-serif text-xl text-text sm:text-2xl">{title}</h1>
      )}
      <div
        ref={setSlotEl}
        className={`flex flex-wrap items-center gap-2 empty:hidden ${title ? "mt-3" : "mt-4"}`}
      />
      <div className="mt-6 flex flex-col">{children}</div>
    </ReaderHeaderSlot.Provider>
  );
}
