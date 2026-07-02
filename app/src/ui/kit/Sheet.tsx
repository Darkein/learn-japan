import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  /** `bottom` = feuille remontant du bas (WordSheet) ; `right` = tiroir latéral (SettingsPanel) ;
   * `fullscreen` = page opaque plein écran, sans assombrissement (ReaderExercises). */
  variant?: "bottom" | "right" | "fullscreen";
  children: ReactNode;
  className?: string;
}

/** Overlay sur-mesure (DESIGN.md §6) : bord = filet + élévation `--elev`. Gère Escape, clic
 * sur le fond pour fermer, et l'encoche (safe-area) des appareils mobiles. */
export function Sheet({ open, onClose, variant = "bottom", children, className = "" }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  if (variant === "fullscreen") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
        <div
          className={`mx-auto flex max-w-[44rem] flex-col gap-4 px-4 pb-6 ${className}`}
          style={{ paddingTop: "calc(var(--safe-t) + 1.5rem)" }}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex ${variant === "right" ? "justify-end" : "items-end justify-center"}`}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/35" aria-hidden="true" />
      <div
        role="dialog"
        className={`relative z-10 flex flex-col overflow-y-auto bg-surface shadow-elev ${
          variant === "right"
            ? "h-full w-72 max-w-[85vw] border-l border-hairline"
            : "w-full max-w-[44rem] animate-rise rounded-t-md border-t border-hairline"
        } ${className}`}
        style={variant === "bottom" ? { paddingBottom: "calc(var(--safe-b) + 1.5rem)" } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
