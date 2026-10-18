import { pathD, type TrackPath } from "../../lib/track";

/** Période des traverses (trait + vide), en px le long du tracé. */
const SLEEPER = "2.4 5";
const SLEEPER_PERIOD = 7.4;

interface Props {
  paths: TrackPath[];
  width: number;
  /** Tranche verticale à dessiner (coordonnées de la voie). */
  y0: number;
  y1: number;
  /** Rails peints : longueur par niveau (animée avec le train). */
  painted: Record<number, number>;
  /** Durée de la transition des rails peints, en secondes (0 = sans animation). */
  duration: number;
}

/**
 * Les rails de la voie (SPEC §5c.2, maquette P2) pour une tranche verticale : ballast et son
 * gravier, traverses qui passent sous deux rails fins, vermillon derrière le train. Chaque
 * tracé est découpé à la tranche, motif des traverses recalé sur la distance de départ pour
 * qu'il ne saute pas d'une tranche à l'autre.
 */
export function Rails({ paths, width, y0, y1, painted, duration }: Props) {
  const h = y1 - y0;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={h}
      viewBox={`0 ${y0} ${width} ${h}`}
      className="pointer-events-none absolute left-0"
      style={{ top: y0 }}
      fill="none"
    >
      {paths.map((p) => {
        const pts = p.points;
        let from = pts.findIndex((q) => q.y >= y0 - 160);
        if (from < 0) return null;
        from = Math.max(0, from - 1);
        let to = pts.findIndex((q) => q.y > y1 + 160);
        to = to < 0 ? pts.length - 1 : to;
        if (to <= from) return null;
        const d = pathD(p, from, to);
        const start = p.dists[from];
        const phase = start % SLEEPER_PERIOD;
        const paint = Math.max(0, (painted[p.level] ?? 0) - start);
        const sleepers = { strokeDasharray: SLEEPER, strokeDashoffset: phase };
        return (
          <g key={`${p.level}:${from}`}>
            <path d={d} stroke="var(--ballast-edge)" strokeWidth={18} />
            <path d={d} stroke="var(--ballast)" strokeWidth={16.4} />
            <path d={d} stroke="var(--ballast-edge)" strokeWidth={16.4} style={{ strokeDasharray: "1 2.6", strokeDashoffset: start % 3.6 }} />
            <path d={d} stroke="var(--sleeper)" strokeWidth={12} style={sleepers} />
            <path d={d} stroke="var(--rail)" strokeWidth={7} />
            {paint > 0 && (
              <path
                d={d}
                stroke="var(--accent)"
                strokeWidth={7}
                style={{
                  strokeDasharray: `${paint} 1000000`,
                  transition: duration ? `stroke-dasharray ${duration}s cubic-bezier(.45,0,.25,1)` : undefined,
                }}
              />
            )}
            <path d={d} stroke="var(--ballast)" strokeWidth={5.2} />
            <path d={d} stroke="var(--sleeper)" strokeWidth={5.2} style={sleepers} />
          </g>
        );
      })}
    </svg>
  );
}
