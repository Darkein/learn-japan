// Les éléments du décor de la voie (SPEC §5c.6, maquette Q), dessinés à l'encre dans une boîte
// de 120 × 80 (sol à y = 72). L'encre est `currentColor` (le texte du thème) à opacité
// faible ; l'eau est l'indigo, la neige `--decor-snow`, le vermillon l'accent. Clair et sombre
// partagent donc les mêmes dessins.

import type { ReactNode } from "react";
import type { SpriteKind } from "../../lib/scenery";

const W = "var(--accent-2)"; // l'eau
const SNOW = "var(--decor-snow)";
const ACC = "var(--accent)";
const BG = "var(--bg)";

/** Un pin japonais, branches en plateaux, au pied (x, 72). */
function pine(x: number, h = 1): ReactNode {
  return (
    <g key={`p${x}`}>
      <path d={`M${x} 72 q-3 ${-10 * h} 2 ${-24 * h}`} stroke="currentColor" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" fill="none" />
      <g fill="currentColor" fillOpacity={0.35}>
        <ellipse cx={x - 4} cy={72 - 22 * h} rx={11} ry={3.5} />
        <ellipse cx={x + 6} cy={72 - 29 * h} rx={9} ry={3} />
        <ellipse cx={x} cy={72 - 35 * h} rx={7} ry={2.6} />
      </g>
    </g>
  );
}

/** Un cèdre, fuseau étagé. */
function cedar(x: number, top = 12): ReactNode {
  return (
    <path
      key={`c${x}`}
      d={`M${x} 72 L${x - 5} 64 L${x - 3} 64 L${x - 8} 52 L${x - 5} 52 L${x - 9} 38 L${x} ${top} L${x + 9} 38 L${x + 5} 52 L${x + 8} 52 L${x + 3} 64 L${x + 5} 64 Z`}
      fill="currentColor"
      fillOpacity={0.42}
    />
  );
}

function waves(y: number, x0 = 0, x1 = 120): ReactNode {
  let d = `M${x0} ${y}`;
  for (let x = x0; x < x1; x += 30) d += ` q7.5 -5 15 0 t15 0`;
  return <path key={`w${y}`} d={d} stroke={W} strokeOpacity={0.55} strokeWidth={1.3} fill="none" />;
}

const SPRITES: Record<SpriteKind, (snowy: boolean) => ReactNode> = {
  fuji: () => (
    <>
      <path d="M8 72 L48 22 Q60 12 72 22 L112 72 Z" fill={W} fillOpacity={0.16} />
      <path d="M40 32 L48 22 Q60 12 72 22 L80 32 L72 37 L66 31 L60 38 L54 31 L48 37 Z" fill={SNOW} stroke={W} strokeOpacity={0.35} strokeWidth={0.8} />
    </>
  ),
  ridge: (snowy) => (
    <>
      <path d="M0 72 L28 36 L44 50 L66 24 L92 52 L104 44 L120 72 Z" fill="currentColor" fillOpacity={0.09} />
      {snowy && <path d="M60 30 L66 24 L72 31 L68 33 L64 30 Z M24 41 L28 36 L32 41 Z" fill={SNOW} />}
      <path d="M0 72 L20 58 L40 64 L64 50 L90 62 L120 54 V72 Z" fill="currentColor" fillOpacity={0.14} />
    </>
  ),
  ford: () => (
    <>
      {waves(50)}
      {waves(62)}
      <g stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.4} strokeLinecap="round">
        <circle cx={60} cy={18} r={2.6} fill="currentColor" fillOpacity={0.7} />
        <path d="M60 21 v6 M56 24 h8" />
        <circle cx={60} cy={30} r={2.6} fill="currentColor" fillOpacity={0.7} />
        <path d="M60 33 v9 M60 42 l-4 8 M60 42 l4 8" />
      </g>
    </>
  ),
  bridge: () => (
    <>
      {waves(74)}
      <path d="M30 62 V74 M90 62 V74 M60 46 V74" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.6} />
      <path d="M6 62 Q60 26 114 62" stroke="currentColor" strokeOpacity={0.65} strokeWidth={3} fill="none" />
      <path d="M10 54 Q60 19 110 54" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2} fill="none" />
      <path d="M24 48 v8 M42 39 v9 M60 36 v9 M78 39 v9 M96 48 v8" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2} />
    </>
  ),
  lake: () => (
    <>
      <ellipse cx={60} cy={58} rx={56} ry={15} fill={W} fillOpacity={0.12} stroke={W} strokeOpacity={0.4} />
      <path d="M20 58 h14 M84 62 h18 M50 66 h12" stroke={W} strokeOpacity={0.4} />
    </>
  ),
  "lake-torii": () => (
    <>
      <ellipse cx={60} cy={58} rx={56} ry={15} fill={W} fillOpacity={0.12} stroke={W} strokeOpacity={0.4} />
      <g stroke={ACC} strokeWidth={2.2} strokeLinecap="round" fill="none">
        <path d="M48 32 Q60 28 72 32" />
        <path d="M51 37 H69 M53 32 V58 M67 32 V58" />
      </g>
      <path d="M53 62 V68 M67 62 V68" stroke={ACC} strokeOpacity={0.35} strokeWidth={1.2} />
    </>
  ),
  sea: () => (
    <>
      <path d="M0 64 Q20 40 36 56 Q30 46 44 46 Q56 46 52 60 Q70 44 86 58 Q80 48 94 48 Q108 48 104 62 L120 64 V74 H0 Z" fill={W} fillOpacity={0.16} stroke={W} strokeOpacity={0.5} strokeWidth={1.2} />
      <path d="M36 50 q3 -2 6 0 M86 52 q3 -2 6 0" stroke={SNOW} strokeWidth={1.6} fill="none" />
    </>
  ),
  rice: () => (
    <>
      <path d="M6 72 L28 40 H114 L100 72 Z" fill={W} fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.25} />
      <path d="M17 56 H107 M34 40 L24 72 M60 40 L52 72 M86 40 L78 72" stroke="currentColor" strokeOpacity={0.25} />
      <path d="M40 50 v-4 M46 50 v-4 M70 50 v-4 M76 50 v-4 M36 66 v-4 M42 66 v-4 M64 66 v-4 M90 66 v-4" stroke="currentColor" strokeOpacity={0.35} />
    </>
  ),
  tea: () => (
    <g fill="currentColor" fillOpacity={0.2}>
      <path d="M2 72 Q12 62 22 72 Q32 62 42 72 Q52 62 62 72 Q72 62 82 72 Q92 62 102 72 Q112 62 120 70 V72 Z" />
      <path d="M14 58 Q22 50 30 58 Q38 50 46 58 Q54 50 62 58 Q70 50 78 58 Q86 50 94 58 Q102 50 110 58 Z" fillOpacity={0.15} />
      <path d="M24 46 Q30 40 36 46 Q42 40 48 46 Q54 40 60 46 Q66 40 72 46 Q78 40 84 46 Q90 40 96 46 Z" fillOpacity={0.1} />
    </g>
  ),
  pines: () => <>{[pine(24), pine(60, 1.1), pine(96)]}</>,
  pine: () => <>{pine(60, 1.2)}</>,
  cedars: () => <>{[cedar(22, 14), cedar(48, 10), cedar(74, 16), cedar(100, 12)]}</>,
  bamboo: () => (
    <>
      <path d="M34 72 V8 M48 72 V14 M62 72 V6 M76 72 V12 M90 72 V10" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <path d="M31 56 h6 M45 44 h6 M59 52 h6 M73 40 h6 M87 58 h6 M31 30 h6 M59 26 h6 M87 32 h6" stroke={BG} strokeWidth={1.2} />
      <path d="M34 20 l-10 4 M48 26 l10 3 M62 18 l-10 4 M76 24 l10 2 M90 22 l-9 5" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),
  sakura: () => (
    <>
      <path d="M60 72 q-2 -14 -10 -22 M58 58 q6 -8 16 -10" stroke="currentColor" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" fill="none" />
      <g fill={ACC} fillOpacity={0.28}>
        <circle cx={46} cy={40} r={11} />
        <circle cx={62} cy={34} r={13} />
        <circle cx={78} cy={42} r={10} />
        <circle cx={56} cy={46} r={9} />
      </g>
      <g fill={ACC} fillOpacity={0.5}>
        <circle cx={40} cy={64} r={1.4} />
        <circle cx={86} cy={60} r={1.4} />
      </g>
    </>
  ),
  maple: () => (
    <>
      <path d="M58 72 q2 -14 -6 -24 M58 60 q8 -6 18 -6" stroke="currentColor" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" fill="none" />
      <g fill={ACC}>
        <circle cx={48} cy={40} r={9} fillOpacity={0.5} />
        <circle cx={66} cy={32} r={10} fillOpacity={0.4} />
        <circle cx={78} cy={46} r={8} fillOpacity={0.45} />
      </g>
    </>
  ),
  hydrangea: () => (
    <>
      <ellipse cx={60} cy={64} rx={40} ry={10} fill="currentColor" fillOpacity={0.12} />
      <g fill={W}>
        <circle cx={38} cy={56} r={7} fillOpacity={0.35} />
        <circle cx={56} cy={52} r={8} fillOpacity={0.5} />
        <circle cx={74} cy={56} r={7} fillOpacity={0.3} />
        <circle cx={88} cy={60} r={6} fillOpacity={0.45} />
      </g>
    </>
  ),
  rain: () => (
    <path
      d="M10 6 L2 40 M24 4 L14 48 M38 8 L28 52 M52 4 L42 50 M66 6 L56 54 M80 4 L70 52 M94 8 L84 50 M108 4 L98 46"
      stroke="currentColor"
      strokeOpacity={0.3}
    />
  ),
  ichirizuka: () => (
    <>
      <path d="M30 72 Q60 44 90 72 Z" fill="currentColor" fillOpacity={0.14} />
      {pine(61, 0.9)}
    </>
  ),
  signpost: () => (
    <>
      <rect x={54} y={26} width={12} height={46} fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeOpacity={0.5} />
      <path d="M60 32 v4 M58 40 h4 M60 44 v6 M58 54 h4 M60 58 v6" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.2} />
    </>
  ),
  jizo: () => (
    <>
      <rect x={44} y={64} width={32} height={8} fill="currentColor" fillOpacity={0.18} />
      <path d="M50 64 V44 Q50 36 60 36 Q70 36 70 44 V64 Z" fill="currentColor" fillOpacity={0.2} stroke="currentColor" strokeOpacity={0.5} />
      <circle cx={60} cy={30} r={7} fill="currentColor" fillOpacity={0.2} stroke="currentColor" strokeOpacity={0.5} />
      <path d="M51 41 L60 52 L69 41 Z" fill={ACC} fillOpacity={0.85} />
    </>
  ),
  lantern: () => (
    <>
      <g fill="currentColor" fillOpacity={0.2} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.2}>
        <path d="M48 72 H72 V68 H48 Z M56 68 V50 H64 V68 Z M50 50 H70 V36 H50 Z M44 36 L60 24 L76 36 Z" />
      </g>
      <rect x={55} y={40} width={10} height={7} fill={ACC} fillOpacity={0.7} />
    </>
  ),
  teahouse: () => (
    <>
      <path d="M30 44 L52 24 H80 L98 44 Z" fill="currentColor" fillOpacity={0.3} />
      <path d="M36 44 V72 M92 44 V72" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <rect x={44} y={60} width={26} height={4} fill="currentColor" fillOpacity={0.4} />
      <path d="M16 30 Q28 22 40 30 Z" fill={ACC} fillOpacity={0.8} />
      <path d="M28 30 V72" stroke="currentColor" strokeOpacity={0.5} />
    </>
  ),
  town: (snowy) => (
    <>
      <g fill="currentColor" fillOpacity={0.32}>
        <path d="M6 50 Q22 42 38 50 Z M42 44 Q60 34 78 44 Z M82 50 Q98 42 114 50 Z" />
      </g>
      {snowy && <path d="M10 49 Q22 43 34 49 M46 43 Q60 36 74 43 M86 49 Q98 43 110 49" stroke={SNOW} strokeWidth={2.2} fill="none" />}
      <g fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.4}>
        <rect x={10} y={50} width={24} height={22} />
        <rect x={46} y={44} width={28} height={28} />
        <rect x={86} y={50} width={24} height={22} />
      </g>
    </>
  ),
  gate: () => (
    <>
      <path d="M30 28 H90 L84 22 H36 Z" fill="currentColor" fillOpacity={0.45} />
      <path d="M38 28 V72 M82 28 V72" stroke="currentColor" strokeOpacity={0.6} strokeWidth={3} />
      <path d="M38 36 H82" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <path d="M4 50 H38 M82 50 H116 M4 62 H38 M82 62 H116 M10 46 V72 M22 46 V72 M98 46 V72 M110 46 V72" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.2} />
    </>
  ),
  ferry: () => (
    <>
      {waves(66)}
      <path d="M20 56 H100 L92 64 H30 Z" fill="currentColor" fillOpacity={0.4} />
      <circle cx={84} cy={36} r={2.6} fill="currentColor" fillOpacity={0.65} />
      <path d="M84 39 V50 M84 50 l-3 6 M84 50 l3 6" stroke="currentColor" strokeOpacity={0.65} strokeWidth={1.4} />
      <path d="M92 22 L76 74" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.3} />
    </>
  ),
  torii: () => (
    <g stroke={ACC} strokeWidth={3.4} strokeLinecap="round" fill="none">
      <path d="M32 22 Q60 15 88 22 M38 31 H82 M44 22 V72 M76 22 V72" />
    </g>
  ),
  shrine: () => (
    <>
      <path d="M24 40 L60 22 L96 40 Z" fill="currentColor" fillOpacity={0.36} />
      <path d="M52 26 L44 14 M68 26 L76 14" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
      <rect x={34} y={40} width={52} height={24} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.4} />
      <path d="M28 64 H92 V72 H28 Z" fill="currentColor" fillOpacity={0.18} />
    </>
  ),
  temple: () => (
    <>
      <path d="M14 40 Q30 36 40 24 H80 Q90 36 106 40 Z" fill="currentColor" fillOpacity={0.38} />
      <rect x={30} y={40} width={60} height={26} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.4} />
      <path d="M44 40 V66 M60 40 V66 M76 40 V66" stroke="currentColor" strokeOpacity={0.3} />
      <path d="M24 66 H96 V72 H24 Z" fill="currentColor" fillOpacity={0.18} />
    </>
  ),
  pagoda: () => (
    <g transform="translate(46 10)" fill="currentColor" fillOpacity={0.42}>
      <path d="M13.4 0 h1.2 v6 h-1.2 Z M6 10 Q14 6 22 10 Z M4 19 Q14 14 24 19 Z M2 28 Q14 22 26 28 Z M0 37 Q14 30 28 37 Z M-2 46 Q14 38 30 46 Z" />
      <rect x={10} y={10} width={8} height={5} />
      <rect x={9} y={19} width={10} height={5} />
      <rect x={8} y={28} width={12} height={5} />
      <rect x={7} y={37} width={14} height={5} />
      <rect x={6} y={46} width={16} height={16} />
    </g>
  ),
  castle: () => (
    <>
      <path d="M26 72 L34 52 H86 L94 72 Z" fill="currentColor" fillOpacity={0.26} />
      <rect x={42} y={38} width={36} height={14} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <path d="M36 40 Q60 32 84 40 Z" fill="currentColor" fillOpacity={0.5} />
      <rect x={48} y={24} width={24} height={12} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <path d="M42 26 Q60 18 78 26 Z M50 14 Q60 8 70 14 L66 18 H54 Z" fill="currentColor" fillOpacity={0.5} />
    </>
  ),
  boats: () => (
    <>
      {waves(66)}
      <path d="M14 58 H52 L46 64 H20 Z" fill="currentColor" fillOpacity={0.4} />
      <path d="M32 58 V30 L48 52 Z" fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <path d="M66 54 H104 L98 60 H72 Z" fill="currentColor" fillOpacity={0.32} />
      <path d="M84 54 V32 L98 50 Z" fill={SNOW} stroke="currentColor" strokeOpacity={0.4} />
    </>
  ),
  kura: () => (
    <>
      <rect x={18} y={38} width={36} height={34} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <rect x={18} y={58} width={36} height={14} fill="currentColor" fillOpacity={0.3} />
      <path d="M14 38 L36 26 L58 38 Z" fill="currentColor" fillOpacity={0.5} />
      <rect x={66} y={44} width={34} height={28} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <rect x={66} y={60} width={34} height={12} fill="currentColor" fillOpacity={0.3} />
      <path d="M62 44 L83 33 L104 44 Z" fill="currentColor" fillOpacity={0.5} />
    </>
  ),
  watermill: () => (
    <>
      {waves(74)}
      <path d="M52 34 L76 22 L100 34 Z" fill="currentColor" fillOpacity={0.4} />
      <rect x={58} y={34} width={38} height={34} fill="currentColor" fillOpacity={0.1} stroke="currentColor" strokeOpacity={0.4} />
      <circle cx={42} cy={52} r={18} stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} fill="none" />
      <path d="M42 34 V70 M24 52 H60 M29 39 L55 65 M55 39 L29 65" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} />
    </>
  ),
  vines: () => (
    <g stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.2}>
      <path d="M8 46 H112 M8 58 H112 M14 40 V72 M44 40 V72 M74 40 V72 M104 40 V72" />
      <g fill="currentColor" fillOpacity={0.25} stroke="none">
        <circle cx={26} cy={50} r={3} />
        <circle cx={58} cy={50} r={3} />
        <circle cx={88} cy={50} r={3} />
        <circle cx={34} cy={62} r={3} />
        <circle cx={66} cy={62} r={3} />
        <circle cx={96} cy={62} r={3} />
      </g>
    </g>
  ),
  orchard: () => (
    <g>
      {[24, 60, 96].map((x) => (
        <g key={x}>
          <path d={`M${x} 72 V56`} stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
          <circle cx={x} cy={48} r={11} fill="currentColor" fillOpacity={0.22} />
          <circle cx={x - 4} cy={46} r={1.6} fill={ACC} fillOpacity={0.7} />
          <circle cx={x + 4} cy={50} r={1.6} fill={ACC} fillOpacity={0.7} />
        </g>
      ))}
    </g>
  ),
  waterfall: () => (
    <>
      <path d="M30 72 L36 20 L52 16 L48 72 Z M72 72 L68 18 L86 22 L92 72 Z" fill="currentColor" fillOpacity={0.18} />
      <path d="M54 18 V66 M58 18 V68 M62 18 V66 M66 20 V68" stroke={W} strokeOpacity={0.5} />
      <ellipse cx={60} cy={70} rx={16} ry={3} fill={W} fillOpacity={0.2} />
    </>
  ),
};

/** Un élément du décor, posé à (x, y) = coin haut-gauche de sa boîte, à l'échelle donnée. */
export function Sprite({ kind, x, y, scale, flip, snowy }: { kind: SpriteKind; x: number; y: number; scale: number; flip?: boolean; snowy: boolean }) {
  const t = flip ? `translate(${x + 120 * scale} ${y}) scale(${-scale} ${scale})` : `translate(${x} ${y}) scale(${scale})`;
  return <g transform={t}>{SPRITES[kind](snowy)}</g>;
}
