import type { TokaidoPosition } from "../lib/tokaido";
import { TOKAIDO } from "../data/tokaido";
import { SectionLabel } from "./kit/SectionLabel";

interface Props {
  pos: TokaidoPosition;
  onOpen: () => void;
}

// Géométrie du SVG : la route est étirée en largeur (preserveAspectRatio="none"), donc on
// ne dessine que des traits verticaux/horizontaux avec non-scaling-stroke — jamais de
// cercle (il serait déformé). Le point de position est un div HTML superposé.
const W = 540; // 54 intervalles × 10
const H = 16;
const MID = 9;

/** Bandeau compact du voyage (accueil) : ligne d'encre, stations en ticks, position accent. */
export function TokaidoStrip({ pos, onOpen }: Props) {
  const pct = (pos.position / (TOKAIDO.length - 1)) * 100;
  const arrived = !pos.next;
  return (
    <button
      className="flex w-full cursor-pointer flex-col gap-2 text-left"
      onClick={onOpen}
      aria-label="Voir le voyage sur le Tōkaidō"
    >
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel className="shrink-0 whitespace-nowrap">
          Tōkaidō · étape {pos.station.index}/{TOKAIDO.length - 1}
        </SectionLabel>
        <span className="truncate text-xs text-muted">
          <span className="font-jp text-text">{pos.station.kanji}</span> {pos.station.romaji}
          {pos.next && (
            <>
              {" → "}
              <span className="font-jp">{pos.next.kanji}</span> {pos.next.romaji}
            </>
          )}
        </span>
      </div>
      <div className="relative">
        <svg
          className="block w-full"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Chemin restant (hairline) puis parcouru (ink), par-dessus. */}
          <line x1={0} y1={MID} x2={W} y2={MID} stroke="var(--hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={MID} x2={(pos.position / (TOKAIDO.length - 1)) * W} y2={MID} stroke="var(--ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {/* Stations : petits ticks verticaux (passées = ink, à venir = hairline). */}
          {TOKAIDO.map((s) => (
            <line
              key={s.index}
              x1={s.index * 10}
              y1={MID - 3}
              x2={s.index * 10}
              y2={MID + 3}
              stroke={s.index <= pos.position ? "var(--ink)" : "var(--hairline)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {/* Voyageur : point accent superposé (HTML pour rester rond). */}
        <span
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      {arrived && <span className="text-xs text-muted">Kyōto atteint — la route est faite.</span>}
    </button>
  );
}
