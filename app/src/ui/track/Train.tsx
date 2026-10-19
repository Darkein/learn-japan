// L'intérieur du train autour de la fenêtre (SPEC §5c.6b) : les poteaux qui filent au ras de la
// vitre, le panneau de quai des gares, la vitre elle-même (reflet, pluie, reflet du wagon la nuit),
// le store replié en haut et la tablette avec sa tasse de thé, en bas.

import { POLE_SPACING, poleXs, WINDOW_BLIND, type Station } from "../../lib/horizon";

/**
 * Les poteaux télégraphiques et leurs deux fils, sur toute la hauteur de la vitre (`height`) :
 * leur tête passe sous le store, leur pied se perd sous le bas de la vitre.
 */
export function Poles({ pos, width, height }: { pos: number; width: number; height: number }) {
  const xs = poleXs(pos, width);
  const arm = WINDOW_BLIND + 8;
  const sag = Math.min(14, height / 8);
  const wires = [arm, arm + 6];
  return (
    <svg width={width} height={height} className="absolute inset-0 block" aria-hidden="true">
      <g stroke="var(--sky-pole)" fill="none" strokeWidth={0.8}>
        {xs
          .slice(1)
          .map((x, i) =>
            wires.map((y) => <path key={`${i}:${y}`} d={`M${xs[i]} ${y} Q${xs[i] + POLE_SPACING / 2} ${y + sag} ${x} ${y}`} />),
          )}
      </g>
      <g fill="var(--sky-pole)">
        {xs.map((x) => (
          <g key={Math.round(x)}>
            <rect x={x - 1.6} y={WINDOW_BLIND - 2} width={3.2} height={height} />
            <rect x={x - 11} y={arm - 1.5} width={22} height={2.4} />
            <rect x={x - 8} y={arm + 4.5} width={16} height={2} />
            {[-9, 9].map((dx) => (
              <circle key={dx} cx={x + dx} cy={arm - 2.5} r={1.6} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Le panneau de quai d'une gare (駅名標) : le nom en kana, en grand, son kanji et son romaji, et
 * le bandeau des gares voisines, la précédente à gauche, la suivante à droite. Posé sur ses deux
 * pieds au bas de la vitre, centré sur `x`.
 */
export function StationSign({ station, x }: { station: Station; x: number }) {
  return (
    <div className="absolute bottom-0 flex flex-col items-center" style={{ left: x, transform: "translateX(-50%)" }}>
      <div className="station-sign flex w-28 flex-col items-center overflow-hidden rounded-sm pt-0.5">
        <span className="font-jp text-[7px] leading-none">{station.kanji}</span>
        <span className="font-jp text-xs leading-tight tracking-widest">{station.kana}</span>
        <span className="text-[6px] leading-none tracking-wide">{station.romaji}</span>
        <div className="station-band mt-0.5 flex w-full justify-between px-1 py-px font-jp text-[6px] leading-none">
          <span>{station.prev ? `← ${station.prev}` : ""}</span>
          <span>{station.next ? `${station.next} →` : ""}</span>
        </div>
      </div>
      <div className="flex w-20 justify-between">
        <span className="station-post h-2.5 w-0.5" />
        <span className="station-post h-2.5 w-0.5" />
      </div>
    </div>
  );
}

/** Les traînées de pluie sur la vitre, poussées par le vent de la course. */
const STREAKS = Array.from({ length: 14 }, (_, i) => ({
  top: 10 + ((i * 37) % 85),
  len: 14 + ((i * 13) % 26),
  dur: 0.9 + ((i * 7) % 10) / 10,
  delay: -((i * 0.37) % 2),
}));

/**
 * La vitre et l'intérieur du wagon, par-dessus le paysage : un reflet en biais, la pluie qui file
 * en saison des pluies, le reflet du wagon éclairé la nuit, le store replié en haut et la tablette
 * avec sa tasse de thé, en bas à droite.
 */
export function Glass({ rain, night }: { rain: boolean; night: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {night && (
        // Le wagon éclairé se reflète : la lampe, et les dossiers des sièges en ombre.
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <g fill="var(--text)" fillOpacity={0.04}>
            <rect x={6} y={78} width={14} height={30} rx={3} />
            <rect x={24} y={80} width={14} height={30} rx={3} />
            <rect x={70} y={79} width={14} height={30} rx={3} />
          </g>
        </svg>
      )}
      {night && <div className="glass-lamp absolute inset-0" />}
      <div className="glass-reflect absolute inset-0" />
      {rain &&
        STREAKS.map((r, i) => (
          <span
            key={i}
            className="glass-rain absolute"
            style={{
              top: `${r.top}%`,
              width: r.len,
              animationDuration: `${r.dur}s`,
              animationDelay: `${r.delay}s`,
            }}
          />
        ))}
      {/* Le store, replié en haut de la vitre. */}
      <div className="window-blind absolute inset-x-0 top-0" style={{ height: WINDOW_BLIND }} />
      {/* La tablette sous la vitre, et la tasse de thé posée dessus. */}
      <svg className="absolute bottom-0 right-3" width={46} height={20} viewBox="0 0 46 20">
        <path d="M18 5 h14 l-1.5 11 h-11 Z" fill="var(--surface-2)" stroke="var(--hairline-strong)" strokeWidth={0.8} />
        <path d="M19 8 h12" stroke="var(--accent-2)" strokeOpacity={0.6} strokeWidth={1.2} />
        <rect x={0} y={16} width={46} height={4} rx={1} fill="var(--surface)" stroke="var(--hairline-strong)" strokeWidth={0.8} />
      </svg>
    </div>
  );
}
