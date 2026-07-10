import type { ReactNode } from "react";
import { useSwipeNav } from "./useSwipeNav";
import { IconArrowLeft, IconArrowRight } from "./kit/Icon";

interface Props {
  /** Aller à l'élément précédent. Absent = extrémité (flèche désactivée, swipe inopérant). */
  onPrev?: () => void;
  /** Aller à l'élément suivant. Absent = extrémité. */
  onNext?: () => void;
  /** Libellés d'accessibilité (« Leçon précédente », « Histoire suivante »…). */
  labels: { prev: string; next: string };
  /** Décalage bas du bloc de flèches (pour dégager le lecteur podcast quand il est actif). */
  bottomOffset?: string;
  children: ReactNode;
}

const ARROW =
  "flex h-11 w-11 items-center justify-center rounded-full border border-hairline-strong " +
  "bg-surface/80 text-muted backdrop-blur-sm transition-colors hover:text-text hover:border-accent " +
  "cursor-pointer disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted " +
  "disabled:hover:border-hairline-strong";

/**
 * Enveloppe une sous-page (leçon / histoire) pour la navigation adjacente : balayage
 * horizontal (swipe, tactile) plus — en desktop uniquement — deux flèches groupées dans le
 * coin bas-droit. Une flèche est désactivée à l'extrémité de la liste. Cf. DESIGN.md.
 */
export function SwipeNavigator({ onPrev, onNext, labels, bottomOffset, children }: Props) {
  const swipe = useSwipeNav({ onPrev, onNext });
  return (
    <div className="touch-pan-y" {...swipe}>
      {/* Flèches desktop seulement (le tactile utilise le swipe), regroupées dans un coin. */}
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
      {children}
    </div>
  );
}
