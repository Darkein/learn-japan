import type { ReactNode } from "react";
import { useSwipeNav, type SwipeDrag } from "./useSwipeNav";
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
 * Retour visuel « en direct » du swipe (façon back-swipe iOS/Android) : une pastille avec
 * flèche apparaît sur le bord vers lequel on tire, glisse et grossit selon l'avancement, puis
 * s'illumine (accent) quand le seuil de déclenchement est atteint (« armé »). Purement décoratif.
 */
function SwipeHint({ drag }: { drag: SwipeDrag }) {
  const active = drag.dir !== 0 && drag.progress > 0;
  const isNext = drag.dir === 1;
  const armed = drag.progress >= 1;
  // Glisse depuis le bord (offset selon 1-progress) et grossit ; suit le doigt (pas de
  // transition en cours de geste), puis se fond au relâché (dir repasse à 0).
  const slide = (isNext ? 1 : -1) * (1 - drag.progress) * 26;
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed top-1/2 z-40 ${isNext ? "right-3" : "left-3"}`}
      style={{
        opacity: active ? 0.35 + 0.65 * drag.progress : 0,
        transform: `translateY(-50%) translateX(${slide}px) scale(${0.65 + 0.35 * drag.progress})`,
        transition: active ? "none" : "opacity 160ms ease-out",
      }}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-full border backdrop-blur-sm ${
          armed
            ? "border-accent bg-accent text-on-accent"
            : "border-hairline-strong bg-surface/90 text-muted"
        }`}
      >
        {isNext ? <IconArrowRight size={22} /> : <IconArrowLeft size={22} />}
      </div>
    </div>
  );
}

/**
 * Enveloppe une sous-page (leçon / histoire) pour la navigation adjacente : balayage
 * horizontal (swipe, tactile) avec retour visuel en direct, plus — en desktop uniquement —
 * deux flèches groupées dans le coin bas-droit. Une flèche est désactivée à l'extrémité.
 */
export function SwipeNavigator({ onPrev, onNext, labels, bottomOffset, children }: Props) {
  const { handlers, drag } = useSwipeNav({ onPrev, onNext });
  return (
    <div className="touch-pan-y" {...handlers}>
      <SwipeHint drag={drag} />
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
