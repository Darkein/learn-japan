import type { ReactNode } from "react";
import { useSwipeNav } from "./useSwipeNav";
import { IconArrowLeft, IconArrowRight } from "./kit/Icon";

interface Props {
  /** Aller à l'élément précédent. Absent = extrémité (flèche masquée, swipe inopérant). */
  onPrev?: () => void;
  /** Aller à l'élément suivant. Absent = extrémité. */
  onNext?: () => void;
  /** Libellés d'accessibilité (« Leçon précédente », « Histoire suivante »…). */
  labels: { prev: string; next: string };
  children: ReactNode;
}

const ARROW =
  "fixed top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full " +
  "border border-hairline-strong bg-surface/80 text-muted backdrop-blur-sm transition-colors " +
  "hover:text-text hover:border-accent cursor-pointer";

/**
 * Enveloppe une sous-page (leçon / histoire) pour la navigation adjacente : balayage
 * horizontal (swipe) plus deux flèches flottantes discrètes sur les bords. Une flèche
 * disparaît à l'extrémité de la liste. Cf. DESIGN.md (minimal, un seul accent).
 */
export function SwipeNavigator({ onPrev, onNext, labels, children }: Props) {
  const swipe = useSwipeNav({ onPrev, onNext });
  return (
    <div {...swipe}>
      {onPrev && (
        <button
          className={`${ARROW} left-2 sm:left-4`}
          onClick={onPrev}
          aria-label={labels.prev}
          title={labels.prev}
        >
          <IconArrowLeft size={20} />
        </button>
      )}
      {onNext && (
        <button
          className={`${ARROW} right-2 sm:right-4`}
          onClick={onNext}
          aria-label={labels.next}
          title={labels.next}
        >
          <IconArrowRight size={20} />
        </button>
      )}
      {children}
    </div>
  );
}
