import type { ReactNode } from "react";
import { useSettings } from "./useSettings";

interface Props {
  /** Titre optionnel affiché dans la barre supérieure (titre de la leçon / histoire). */
  title?: string;
  onBack: () => void;
  children?: ReactNode;
}

/**
 * Page dédiée vers laquelle on navigue (lecture, révision) : remplace le shell à
 * onglets par une vue épurée avec une barre fine « ← Retour » + titre. Objectif :
 * navigation simple, page lisible (cf. DESIGN.md — filets, un seul accent).
 */
export function ReaderPage({ title, onBack, children }: Props) {
  const { openPanel } = useSettings();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline gap-4 border-b border-hairline pb-3">
        <button
          className="cursor-pointer py-1 font-sans text-sm tracking-wide text-muted transition-colors hover:text-text"
          onClick={onBack}
        >
          ← Retour
        </button>
        {title && <span className="flex-1 font-serif text-lg text-text">{title}</span>}
        <button
          className="cursor-pointer px-1 text-base leading-none text-muted hover:text-text"
          onClick={openPanel}
          aria-label="Paramètres"
        >
          ⚙
        </button>
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}
