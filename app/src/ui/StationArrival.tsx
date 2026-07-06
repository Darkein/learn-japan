import type { TokaidoStation } from "../data/tokaido";
import { TOKAIDO } from "../data/tokaido";
import { Button } from "./kit/Button";
import { SectionLabel } from "./kit/SectionLabel";
import { Sheet } from "./kit/Sheet";

interface Props {
  station: TokaidoStation;
  onClose: () => void;
}

/**
 * Célébration d'arrivée à une station du Tōkaidō — sobre : le nom en calligraphie, un
 * trait d'encre qui se révèle (stroke-dashoffset, coupé sous prefers-reduced-motion via
 * la règle globale), un fait bref. Aucun confetti (DESIGN.md §2).
 */
export function StationArrival({ station, onClose }: Props) {
  const last = station.index === TOKAIDO.length - 1;
  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col items-center gap-4 px-2 py-6 text-center">
        <SectionLabel>
          {last ? "Terme du voyage" : `${station.index}ᵉ étape du Tōkaidō`}
        </SectionLabel>
        <p className="font-jp text-3xl text-text">{station.kanji}</p>
        {/* Trait d'encre révélé sous le nom. */}
        <svg width="120" height="8" viewBox="0 0 120 8" aria-hidden="true">
          <path
            className="ink-reveal"
            d="M2 5 Q60 2 118 4"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1.5"
            strokeLinecap="round"
            pathLength="1"
          />
        </svg>
        <p className="text-sm text-muted">
          {last ? "Tu arrives à" : "Tu arrives à l'étape"}{" "}
          <span className="text-text">{station.romaji}</span>.
        </p>
        {station.note && <p className="max-w-sm text-sm leading-relaxed text-muted">{station.note}</p>}
        <Button variant="primary" onClick={onClose}>
          {last ? "Contempler le chemin" : "Continuer la route"}
        </Button>
      </div>
    </Sheet>
  );
}
