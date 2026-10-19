import { pathD, type TrackPath } from "../../lib/track";
import { WATER_H, type Decor as DecorData, type DecorCrossing } from "../../lib/scenery";
import { Sprite } from "./sprites";
import { UniqueArt } from "./uniques";

interface Props {
  decor: DecorData;
  paths: TrackPath[];
  width: number;
  /** Tranche verticale à dessiner (coordonnées de la voie). */
  y0: number;
  y1: number;
}

/** Le bout de tracé qui passe à la hauteur y (du point d'avant au point d'après). */
function pathAt(paths: TrackPath[], y: number): string | null {
  for (const p of paths) {
    const i = p.points.findIndex((q) => q.y > y);
    if (i > 0) return pathD(p, i - 1, i);
  }
  return null;
}

/** La bande d'eau d'une traversée : indigo pâle, deux lignes de vagues. */
function Water({ c, width }: { c: DecorCrossing; width: number }) {
  const top = c.y - WATER_H / 2;
  let wave = "";
  for (let x = -10; x < width + 30; x += 30) wave += ` M${x} 0 q7.5 -4 15 0 t15 0`;
  return (
    <g>
      <rect x={0} y={top} width={width} height={WATER_H} fill="var(--decor-water)" opacity={0.35} />
      <path d={wave} transform={`translate(0 ${top + 13})`} stroke="var(--accent-2)" strokeOpacity={0.5} strokeWidth={1.2} fill="none" />
      <path d={wave} transform={`translate(15 ${top + 27})`} stroke="var(--accent-2)" strokeOpacity={0.4} strokeWidth={1.2} fill="none" />
    </g>
  );
}

/**
 * Le décor de la voie pour une tranche (SPEC §5c.6), sous les rails : le lointain pâle, l'eau
 * des traversées et leurs ouvrages (tablier du pont, pilotis du gué), puis les éléments près
 * de la voie. L'encre est la couleur du texte : clair et sombre partagent les dessins.
 */
export function Decor({ decor, paths, width, y0, y1 }: Props) {
  const h = y1 - y0;
  const visible = decor.items.filter((it) => it.y + 80 * it.scale >= y0 - 20 && it.y <= y1 + 20);
  const crossings = decor.crossings.filter((c) => c.y + WATER_H >= y0 && c.y - WATER_H <= y1);
  const uniques = decor.uniques.filter((u) => u.box.y + u.box.h >= y0 - 20 && u.box.y <= y1 + 20);
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={h}
      viewBox={`0 ${y0} ${width} ${h}`}
      className="pointer-events-none absolute left-0 text-text"
      style={{ top: y0 }}
    >
      <g opacity={0.6}>
        {visible.filter((it) => it.far).map((it, i) => (
          <Sprite key={`f${i}:${Math.round(it.y)}`} {...it} />
        ))}
      </g>
      {uniques.map((u) => {
        const mid = u.box.y + u.box.h / 2;
        const rail = decor.crossings.find((c) => Math.abs(c.y - mid) < 2)?.x;
        return <UniqueArt key={`u:${u.kind}:${Math.round(u.box.y)}`} unique={u} railX={rail} width={width} />;
      })}
      {crossings.map((c) => {
        const d = pathAt(paths, c.y);
        const clip = `cross-${Math.round(c.y)}`;
        return (
          <g key={clip}>
            <Water c={c} width={width} />
            <clipPath id={clip}>
              <rect x={0} y={c.y - WATER_H / 2 - 4} width={width} height={WATER_H + 8} />
            </clipPath>
            {d && c.type === "bridge" && (
              // Le pont de bois : un tablier plus large que le ballast, bordé de garde-corps.
              <g clipPath={`url(#${clip})`} fill="none">
                <path d={d} stroke="currentColor" strokeOpacity={0.5} strokeWidth={30} />
                <path d={d} stroke="var(--bg)" strokeWidth={26} />
                <path d={d} stroke="currentColor" strokeOpacity={0.18} strokeWidth={26} style={{ strokeDasharray: "1.5 6" }} />
              </g>
            )}
            {d && c.type === "ford" && (
              // Le gué : les rails passent sur pilotis, plantés dans l'eau de part et d'autre.
              <g clipPath={`url(#${clip})`} fill="none">
                <path d={d} stroke="currentColor" strokeOpacity={0.55} strokeWidth={24} style={{ strokeDasharray: "2 7" }} />
                <path d={d} stroke="var(--decor-water)" strokeWidth={19} />
              </g>
            )}
          </g>
        );
      })}
      {visible.filter((it) => !it.far).map((it, i) => (
        <Sprite key={`n${i}:${Math.round(it.y)}`} {...it} />
      ))}
    </svg>
  );
}

/**
 * Le bac (SPEC §5c.6, règle 3) : par-dessus les rails, l'eau recouvre la voie ; le trajet en
 * bateau est une ligne en pointillés, le bac posé dessus.
 */
export function Ferries({ decor, paths, width, y0, y1 }: Props) {
  const ferries = decor.crossings.filter((c) => c.type === "ferry" && c.y + WATER_H >= y0 && c.y - WATER_H <= y1);
  if (!ferries.length) return null;
  const h = y1 - y0;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={h}
      viewBox={`0 ${y0} ${width} ${h}`}
      className="pointer-events-none absolute left-0 text-text"
      style={{ top: y0 }}
    >
      {ferries.map((c) => {
        const d = pathAt(paths, c.y);
        const clip = `ferry-${Math.round(c.y)}`;
        return (
          <g key={clip}>
            <clipPath id={clip}>
              <rect x={0} y={c.y - WATER_H / 2} width={width} height={WATER_H} />
            </clipPath>
            <rect x={0} y={c.y - WATER_H / 2} width={width} height={WATER_H} fill="var(--bg)" />
            <Water c={c} width={width} />
            {d && (
              <path
                d={d}
                clipPath={`url(#${clip})`}
                stroke="currentColor"
                strokeOpacity={0.55}
                strokeWidth={2}
                fill="none"
                style={{ strokeDasharray: "3 5" }}
              />
            )}
            <Sprite kind="ferry" x={c.x > width / 2 ? c.x - 74 : c.x + 14} y={c.y - 36} scale={0.5} snowy={false} />
          </g>
        );
      })}
    </svg>
  );
}
