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

/**
 * L'encre diluée sur le papier, mais opaque : `o` est la part de couleur, mêlée au papier
 * (`--paper`, le fond de la voie, ou le sol dans la bande de ciel). Un bâtiment cache ce qu'il
 * recouvre, et ses parties se recouvrent sans se voir l'une à travers l'autre.
 */
export const tint = (o: number, c = "currentColor") => `color-mix(in srgb, ${c} ${Math.round(o * 100)}%, var(--paper, var(--bg)))`;

/** Un pin japonais, branches en plateaux, au pied (x, 72). */
function pine(x: number, h = 1): ReactNode {
  return (
    <g key={`p${x}`}>
      <path d={`M${x} 72 q-3 ${-10 * h} 2 ${-24 * h}`} stroke="currentColor" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" fill="none" />
      <g fill={tint(0.35)}>
        <ellipse cx={x - 4} cy={72 - 22 * h} rx={11} ry={3.5} />
        <ellipse cx={x + 6} cy={72 - 29 * h} rx={9} ry={3} />
        <ellipse cx={x} cy={72 - 35 * h} rx={7} ry={2.6} />
      </g>
    </g>
  );
}

/**
 * Un cèdre du Japon (sugi) : fuseau étroit aux étages de branches qui retombent, plus large vers
 * le bas, son tronc au pied. `top` est la cime ; `w` la demi-largeur au pied.
 */
function cedar(x: number, top = 12, w = 9, opacity = 0.42): ReactNode {
  const n = 6;
  const base = 66;
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = top + ((base - top) * i) / n;
    const y1 = top + ((base - top) * (i + 1)) / n;
    const hw = w * (0.3 + (0.7 * (i + 1)) / n);
    // Chaque étage : la branche part vers l'extérieur et retombe, puis on revient vers le fût.
    left.push(`L${x - hw * 0.55} ${y0 + 2} Q${x - hw} ${y1 - 3} ${x - hw * 1.05} ${y1}`);
    right.unshift(`L${x + hw * 1.05} ${y1}`, `Q${x + hw} ${y1 - 3} ${x + hw * 0.55} ${y0 + 2}`);
  }
  return (
    <g key={`c${x}`}>
      <path d={`M${x - 1.2} 72 V${base} H${x + 1.2} V72 Z`} fill={tint(opacity + 0.1)} />
      <path
        d={`M${x} ${top} ${left.join(" ")} L${x} ${base - 2} ${right.join(" ")} Z`}
        fill={tint(opacity)}
      />
    </g>
  );
}

function waves(y: number, x0 = 0, x1 = 120): ReactNode {
  let d = `M${x0} ${y}`;
  for (let x = x0; x + 30 <= x1; x += 30) d += ` q7.5 -5 15 0 t15 0`;
  return <path key={`w${y}`} d={d} stroke={W} strokeOpacity={0.55} strokeWidth={1.3} fill="none" />;
}

/** Une eau de y0 à y1 sur la largeur de la boîte, ses bouts effilés en rive. */
function pool(y0: number, y1: number, opacity = 0.13): ReactNode {
  const m = (y0 + y1) / 2;
  return <path key={`p${y0}`} d={`M2 ${m} Q6 ${y0} 26 ${y0} H94 Q114 ${y0} 118 ${m} Q114 ${y1} 92 ${y1} H28 Q6 ${y1} 2 ${m} Z`} fill={W} fillOpacity={opacity} />;
}

/**
 * Un toit japonais vu de face : égout de `w` px à la hauteur y, faîtage `h` px plus haut, les
 * coins de l'égout relevés (courbe concave).
 */
function roof(cx: number, y: number, w: number, h: number, opacity = 0.5, key?: string): ReactNode {
  const l = cx - w / 2;
  const r = cx + w / 2;
  return (
    <path
      key={key ?? `r${cx}:${y}`}
      d={`M${l} ${y} Q${l + w * 0.16} ${y - h * 0.18} ${cx - w * 0.3} ${y - h} H${cx + w * 0.3} Q${r - w * 0.16} ${y - h * 0.18} ${r} ${y} Z`}
      fill={tint(opacity)}
    />
  );
}

/** Un mur blanc d'étage (château, entrepôt) avec ses fenêtres. */
function wall(x: number, y: number, w: number, h: number, windows = 0): ReactNode {
  const out: ReactNode[] = [
    <rect key="w" x={x} y={y} width={w} height={h} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8} />,
  ];
  for (let i = 0; i < windows; i++) {
    const wx = x + ((i + 0.5) * w) / windows - 1.5;
    out.push(<rect key={i} x={wx} y={y + h * 0.35} width={3} height={h * 0.32} fill={tint(0.45)} />);
  }
  return <g key={`wall${x}:${y}`}>{out}</g>;
}

/** Un torii vermillon : linteau galbé aux bouts relevés, entretoise, piliers un peu écartés. */
function toriiShape(cx: number, top: number, w: number, foot: number): ReactNode {
  const h = foot - top;
  const pl = cx - w * 0.3;
  const pr = cx + w * 0.3;
  return (
    <g key={`t${cx}`} fill={ACC}>
      <path d={`M${cx - w / 2} ${top + 3} Q${cx} ${top - 4} ${cx + w / 2} ${top + 3} L${cx + w / 2 - 2} ${top + 6} Q${cx} ${top + 1} ${cx - w / 2 + 2} ${top + 6} Z`} />
      <rect x={cx - w * 0.42} y={top + 6} width={w * 0.84} height={2.6} />
      <rect x={cx - w * 0.38} y={top + h * 0.24} width={w * 0.76} height={2.6} />
      <rect x={cx - 1.4} y={top + 8} width={2.8} height={h * 0.24 - 8} />
      <path d={`M${pl - 1.6} ${top + 7} L${pl - 3.4} ${foot} H${pl + 1.4} L${pl + 1.6} ${top + 7} Z M${pr - 1.6} ${top + 7} L${pr - 1.4} ${foot} H${pr + 3.4} L${pr + 1.6} ${top + 7} Z`} />
    </g>
  );
}

/** Un lac : rive lointaine et ses collines, l'eau, des roseaux au premier plan. */
function lakeBase(): ReactNode {
  return (
    <g key="lake">
      <path d="M4 52 Q12 40 36 45 Q58 32 82 43 Q104 36 116 52 Z" fill={tint(0.1)} />
      <path d="M2 58 Q8 50 30 50 H90 Q112 50 118 57 Q114 68 90 70 Q60 74 30 70 Q6 68 2 58 Z" fill={W} fillOpacity={0.13} />
      <path d="M14 56 h18 M70 54 h22 M42 62 h16 M90 63 h14" stroke={W} strokeOpacity={0.4} />
      <path d="M8 72 q1 -9 -2 -15 M12 72 q0 -11 3 -17 M16 72 q-1 -7 -4 -11 M108 72 q-1 -9 2 -14 M112 72 q0 -7 -3 -10" stroke="currentColor" strokeOpacity={0.45} fill="none" />
    </g>
  );
}

const SPRITES: Record<SpriteKind, (snowy: boolean) => ReactNode> = {
  fuji: () => (
    <>
      <path d="M8 72 L48 22 Q60 12 72 22 L112 72 Z" fill={tint(0.16, W)} />
      <path d="M40 32 L48 22 Q60 12 72 22 L80 32 L72 37 L66 31 L60 38 L54 31 L48 37 Z" fill={SNOW} stroke={W} strokeOpacity={0.35} strokeWidth={0.8} />
    </>
  ),
  ridge: (snowy) => (
    // Une chaîne de montagnes à l'encre : la chaîne lointaine pâle et ses pics, une écharpe de
    // brume, puis les contreforts plus sombres piqués de cèdres.
    <>
      <path
        d="M0 72 Q4 54 10 42 L17 44 L29 30 L37 34 L50 17 L58 24 L64 22 L76 34 L84 29 L96 40 L106 36 L114 42 Q118 56 120 72 Z"
        fill={tint(0.08)}
      />
      {snowy && <path d="M45 23 L50 17 L56 22.5 L53 24 L50 21.5 L47.5 25 Z M25 34 L29 30 L33 32 L30 33.5 Z M81 31.5 L84 29 L87 32 Z" fill={SNOW} />}
      <path d="M0 58 Q30 52 60 56 Q90 60 120 54 V60 Q90 66 60 62 Q30 58 0 64 Z" fill={BG} fillOpacity={0.55} />
      <path d="M0 72 Q6 58 28 57 Q40 47 54 53 Q66 59 78 51 Q92 43 104 51 Q114 56 120 72 Z" fill={tint(0.15)} />
      <path d="M38 52 l2 -6 l2 6 Z M46 54 l2 -5 l2 5 Z M86 48 l2 -6 l2 6 Z M94 50 l2 -5 l2 5 Z M100 52 l1.6 -4 l1.6 4 Z" fill={tint(0.22)} />
    </>
  ),
  ford: () => (
    // Le gué à porteurs (kawagoshi) : deux porteurs dans l'eau jusqu'à la taille, l'estrade
    // sur les épaules, le voyageur assis dessus sous son chapeau.
    <>
      {pool(52, 74, 0.14)}
      <g fill={tint(0.6)}>
        <circle cx={38} cy={38} r={3} />
        <circle cx={82} cy={38} r={3} />
        <path d="M35 42 h6 l1 14 h-8 Z M79 42 h6 l1 14 h-8 Z" />
      </g>
      <rect x={30} y={40} width={60} height={3} fill={tint(0.55)} />
      <path d="M33 43 v4 M87 43 v4" stroke="currentColor" strokeOpacity={0.5} />
      <path d="M53 40 Q60 30 67 40 Z" fill={tint(0.45)} />
      <circle cx={60} cy={28} r={2.6} fill={tint(0.55)} />
      <path d="M52 27 L60 21 L68 27 Z" fill={tint(0.6)} />
      {waves(58, 14, 104)}
      {waves(67, 24, 114)}
    </>
  ),
  bridge: () => (
    // Un pont de bois en arc : tablier épais, garde-corps à balustres, piles plantées dans l'eau.
    <>
      {pool(62, 76, 0.12)}
      {waves(70, 16, 106)}
      <path d="M24 55 V72 M42 50 V72 M60 49 V72 M78 50 V72 M96 55 V72" stroke="currentColor" strokeOpacity={0.4} strokeWidth={2} />
      <path d="M24 62 L42 58 M42 58 L60 62 M60 62 L78 58 M78 58 L96 62" stroke="currentColor" strokeOpacity={0.2} />
      <path d="M2 60 Q60 30 118 60 L118 64 Q60 35 2 64 Z" fill={tint(0.5)} />
      <path d="M6 53 Q60 24 114 53" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.3} fill="none" />
      <path d="M14 51 v7 M28 45 v7 M44 40 v8 M60 38 v8 M76 40 v8 M92 45 v7 M106 51 v7" stroke="currentColor" strokeOpacity={0.5} />
    </>
  ),
  lake: () => (
    <>
      {lakeBase()}
      <path d="M66 58 h18 l-3 3 h-12 Z" fill={tint(0.4)} />
      <path d="M74 58 V49" stroke="currentColor" strokeOpacity={0.5} />
    </>
  ),
  "lake-torii": () => (
    // Le torii dans l'eau du lac Ashi : planté dans le lac, son reflet dessous.
    <>
      {lakeBase()}
      {toriiShape(60, 22, 34, 62)}
      <g opacity={0.25}>
        <path d="M50 63 V71 M70 63 V71" stroke={ACC} strokeWidth={2.4} />
      </g>
    </>
  ),
  sea: () => (
    // La mer à la manière d'Hokusai : une vague qui se dresse et se recourbe en griffes
    // d'écume, la houle derrière.
    <>
      {pool(54, 76, 0.12)}
      <path d="M0 60 Q8 52 14 46 Q24 30 44 28 Q60 27 64 38 Q58 33 51 35 Q57 39 55 46 Q48 42 42 46 Q34 52 30 60 Z" fill={W} fillOpacity={0.32} stroke={W} strokeOpacity={0.6} strokeWidth={1.1} />
      <path d="M44 28 q6 -3 9 2 q3 -3 7 1 q3 -1 4 4" stroke={SNOW} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <path d="M70 58 Q80 48 92 50 Q100 51 100 57 Q94 54 90 57 Z" fill={W} fillOpacity={0.25} stroke={W} strokeOpacity={0.5} />
      {waves(64, 6, 96)}
      {waves(70, 22, 112)}
    </>
  ),
  rice: () => {
    // Des rizières en eau, vues de biais : quelques planches qui s'éloignent vers l'horizon,
    // séparées par leurs diguettes, des touffes de jeunes plants, le ciel qui s'y reflète.
    const vp = { x: 60, y: 14 };
    const at = (x: number, y: number) => vp.x + ((x - vp.x) * (y - vp.y)) / (72 - vp.y);
    let bunds = "";
    for (const x of [-10, 40, 90, 140]) bunds += `M${at(x, 42)} 42 L${at(x, 72)} 72 `;
    bunds += `M${at(-30, 52)} 52 H${at(150, 52)} `;
    let shoots = "";
    for (const [y, step, h] of [[48, 7, 1.6], [60, 9, 2.4], [67, 10, 3]] as const) {
      for (let x = at(-30, y) + 4 + (y % 3); x < at(150, y) - 4; x += step) shoots += `M${x - 1} ${y} l1 ${-h} l1 ${h} `;
    }
    return (
      <>
        <defs>
          <clipPath id="rice-clip">
            <path d="M6 50 Q20 41 50 42 Q80 39 106 43 Q118 47 116 56 Q112 70 88 72 Q60 76 28 72 Q2 68 6 50 Z" />
          </clipPath>
        </defs>
        <g clipPath="url(#rice-clip)">
          <rect x={0} y={38} width={120} height={38} fill={W} fillOpacity={0.12} />
          <path d="M26 46 h12 M72 57 h14" stroke={SNOW} strokeOpacity={0.4} strokeWidth={0.9} />
          <path d={shoots} stroke="currentColor" strokeOpacity={0.4} strokeWidth={0.8} fill="none" />
          <path d={bunds} stroke="currentColor" strokeOpacity={0.24} strokeWidth={1.4} fill="none" />
        </g>
      </>
    );
  },
  tea: () => (
    <g>
      <path fill={tint(0.2)} d="M2 72 Q12 62 22 72 Q32 62 42 72 Q52 62 62 72 Q72 62 82 72 Q92 62 102 72 Q112 62 120 70 V72 Z" />
      <path d="M14 58 Q22 50 30 58 Q38 50 46 58 Q54 50 62 58 Q70 50 78 58 Q86 50 94 58 Q102 50 110 58 Z" fillOpacity={0.15} />
      <path d="M24 46 Q30 40 36 46 Q42 40 48 46 Q54 40 60 46 Q66 40 72 46 Q78 40 84 46 Q90 40 96 46 Z" fillOpacity={0.1} />
    </g>
  ),
  pines: () => <>{[pine(24), pine(60, 1.1), pine(96)]}</>,
  pine: () => <>{pine(60, 1.2)}</>,
  cedars: () => (
    // Une allée de cèdres : de hauts fuseaux serrés, ceux du fond plus pâles.
    <>
      {cedar(34, 14, 8, 0.28)}
      {cedar(86, 12, 8, 0.28)}
      {cedar(16, 22, 9)}
      {cedar(56, 6, 10)}
      {cedar(104, 18, 9)}
    </>
  ),
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
      <ellipse cx={60} cy={64} rx={40} ry={10} fill={tint(0.12)} />
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
      <path d="M30 72 Q60 44 90 72 Z" fill={tint(0.14)} />
      {pine(61, 0.9)}
    </>
  ),
  signpost: () => (
    // Le poteau indicateur (道標) : pilier de pierre coiffé, gravé, sur son socle.
    <>
      <rect x={48} y={67} width={24} height={5} fill={tint(0.22)} />
      <rect x={54} y={20} width={12} height={47} fill={tint(0.14)} stroke="currentColor" strokeOpacity={0.5} strokeWidth={0.9} />
      <path d="M52 20 L60 13 L68 20 Z" fill={tint(0.4)} />
      <path d="M57 26 h6 M60 24 v9 M57 38 h6 M58 42 l4 0 M60 38 v10 M57 54 h6 M60 52 v10" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.1} />
    </>
  ),
  jizo: () => (
    <>
      <rect x={44} y={64} width={32} height={8} fill={tint(0.18)} />
      <path d="M50 64 V44 Q50 36 60 36 Q70 36 70 44 V64 Z" fill={tint(0.2)} stroke="currentColor" strokeOpacity={0.5} />
      <circle cx={60} cy={30} r={7} fill={tint(0.2)} stroke="currentColor" strokeOpacity={0.5} />
      <path d="M51 41 L60 52 L69 41 Z" fill={ACC} fillOpacity={0.85} />
    </>
  ),
  lantern: () => (
    <>
      <g fill={tint(0.2)} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.2}>
        <path d="M48 72 H72 V68 H48 Z M56 68 V50 H64 V68 Z M50 50 H70 V36 H50 Z M44 36 L60 24 L76 36 Z" />
      </g>
      <rect x={55} y={40} width={10} height={7} fill={ACC} fillOpacity={0.7} />
    </>
  ),
  teahouse: () => (
    // Une maison de thé au bord de la route : toit de chaume épais, banc sous l'auvent, et
    // l'ombrelle rouge plantée devant.
    <>
      <path d="M24 44 Q32 32 46 22 H76 Q90 32 98 44 Z" fill={tint(0.32)} />
      <path d="M44 26 L38 42 M60 23 V42 M76 26 L82 42" stroke="currentColor" strokeOpacity={0.14} />
      <path d="M32 44 V72 M90 44 V72" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <rect x={36} y={44} width={50} height={10} fill={tint(0.06)} />
      <rect x={44} y={60} width={34} height={3} fill={tint(0.45)} />
      <path d="M47 63 V70 M75 63 V70" stroke="currentColor" strokeOpacity={0.45} />
      <path d="M4 34 Q16 22 28 34 Q16 31 4 34 Z" fill={ACC} fillOpacity={0.85} />
      <path d="M16 31 V72" stroke="currentColor" strokeOpacity={0.5} />
    </>
  ),
  town: (snowy) => (
    // Une ville-étape : trois maisons de marchands (machiya) côte à côte, un étage bas, l'auvent
    // au-dessus de la façade à claire-voie, la porte sombre.
    <>
      {[4, 43, 82].map((x0) => (
        <g key={x0}>
          <path d={`M${x0 - 3} 38 L${x0 + 5} 30 H${x0 + 29} L${x0 + 37} 38 Z`} fill={tint(0.45)} />
          {snowy && <path d={`M${x0 + 5} 30.5 H${x0 + 29}`} stroke={SNOW} strokeWidth={2.4} />}
          <rect x={x0} y={38} width={34} height={9} fill={tint(0.08)} stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} />
          <path d={`M${x0 + 6} 41 h6 M${x0 + 22} 41 h6`} stroke="currentColor" strokeOpacity={0.35} strokeWidth={2} />
          <path d={`M${x0 - 2} 52 L${x0 + 2} 47 H${x0 + 32} L${x0 + 36} 52 Z`} fill={tint(0.4)} />
          <rect x={x0} y={52} width={34} height={20} fill={tint(0.06)} stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.8} />
          <path
            d={Array.from({ length: 8 }, (_, i) => `M${x0 + 3 + i * 1.7} 55 V70`).join(" ") + " " + Array.from({ length: 6 }, (_, i) => `M${x0 + 23 + i * 1.7} 55 V70`).join(" ")}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={0.6}
          />
          <rect x={x0 + 17} y={56} width={5} height={16} fill={tint(0.3)} />
        </g>
      ))}
    </>
  ),
  roofs: (snowy) => (
    // Les toits serrés d'une grande ville, en trois rangs qui s'éloignent : pâles au fond, plus
    // sombres devant. Dans un rang, les maisons se touchent, sur un même mur.
    <>
      {[
        { w: 24, y: 44, h: 6, wall: 6, op: 0.18 },
        { w: 30, y: 54, h: 7, wall: 8, op: 0.3 },
        { w: 40, y: 64, h: 8, wall: 8, op: 0.42 },
      ].map((row, r) => (
        <g key={r}>
          <rect x={0} y={row.y} width={120} height={row.wall} fill={BG} />
          <rect x={0} y={row.y} width={120} height={row.wall} fill={tint(0.06)} />
          <path
            d={Array.from({ length: Math.ceil(120 / row.w) + 1 }, (_, i) => `M${i * row.w} ${row.y} V${row.y + row.wall}`).join(" ")}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={0.7}
          />
          {Array.from({ length: Math.ceil(120 / row.w) }, (_, i) => (
            <g key={i}>
              <path
                d={`M${i * row.w - 1} ${row.y + 1} L${i * row.w + row.w * 0.22} ${row.y + 1 - row.h} H${i * row.w + row.w * 0.78} L${(i + 1) * row.w + 1} ${row.y + 1} Z`}
                fill={tint(row.op)}
              />
              {snowy && <path d={`M${row.w * 0.2 + i * row.w} ${row.y + 1.4 - row.h} h${row.w * 0.6}`} stroke={SNOW} strokeWidth={2} />}
            </g>
          ))}
        </g>
      ))}
    </>
  ),
  volcano: (snowy) => (
    // Un volcan (l'Asama) : large cône aux flancs creusés, cratère ébréché, panache épais.
    <>
      <path d="M0 72 Q30 60 42 34 L50 28 L55 31 L62 28 L68 30 L78 34 Q90 60 120 72 Z" fill={tint(0.16)} />
      <path d="M48 33 L38 62 M60 30 L58 66 M72 33 L82 62" stroke="currentColor" strokeOpacity={0.1} strokeWidth={1.2} />
      {snowy && <path d="M43 36 L50 28 L55 31 L62 28 L68 30 L77 36 L70 39 L63 35 L57 40 L50 35 Z" fill={SNOW} />}
      <path d="M58 27 Q52 20 58 15 Q64 10 58 4 M64 26 Q70 20 66 14" stroke="currentColor" strokeOpacity={0.3} strokeWidth={3} fill="none" strokeLinecap="round" />
    </>
  ),
  onsen: () => (
    // Une source chaude : le bassin et ses trois volutes de vapeur (♨).
    <>
      <ellipse cx={60} cy={64} rx={34} ry={7} fill={W} fillOpacity={0.25} stroke="currentColor" strokeOpacity={0.4} />
      <path d="M46 52 q-6 -8 0 -16 q6 -8 0 -16 M60 50 q-6 -8 0 -16 q6 -8 0 -16 M74 52 q-6 -8 0 -16 q6 -8 0 -16" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    </>
  ),
  gate: () => (
    <>
      <path d="M30 28 H90 L84 22 H36 Z" fill={tint(0.45)} />
      <path d="M38 28 V72 M82 28 V72" stroke="currentColor" strokeOpacity={0.6} strokeWidth={3} />
      <path d="M38 36 H82" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <path d="M4 50 H38 M82 50 H116 M4 62 H38 M82 62 H116 M10 46 V72 M22 46 V72 M98 46 V72 M110 46 V72" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1.2} />
    </>
  ),
  ferry: () => (
    <>
      {waves(66)}
      <path d="M20 56 H100 L92 64 H30 Z" fill={tint(0.4)} />
      <circle cx={84} cy={36} r={2.6} fill={tint(0.65)} />
      <path d="M84 39 V50 M84 50 l-3 6 M84 50 l3 6" stroke="currentColor" strokeOpacity={0.65} strokeWidth={1.4} />
      <path d="M92 22 L76 74" stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.3} />
    </>
  ),
  torii: () => <>{toriiShape(60, 16, 56, 72)}</>,
  shrine: () => (
    <>
      <path d="M24 40 L60 22 L96 40 Z" fill={tint(0.36)} />
      <path d="M52 26 L44 14 M68 26 L76 14" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
      <rect x={34} y={40} width={52} height={24} fill={tint(0.1)} stroke="currentColor" strokeOpacity={0.4} />
      <path d="M28 64 H92 V72 H28 Z" fill={tint(0.18)} />
    </>
  ),
  temple: () => (
    // Un temple : grand toit à coins relevés sur sa salle à piliers, l'escalier et le socle.
    <>
      <rect x={30} y={40} width={60} height={26} fill={tint(0.08)} stroke="currentColor" strokeOpacity={0.4} strokeWidth={0.8} />
      <path d="M38 40 V66 M50 40 V66 M70 40 V66 M82 40 V66" stroke="currentColor" strokeOpacity={0.3} />
      <rect x={52} y={48} width={16} height={18} fill={tint(0.22)} />
      {roof(60, 42, 100, 20, 0.42)}
      <path d="M38 23 H82" stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
      <path d="M22 66 H98 V72 H22 Z" fill={tint(0.18)} />
      <path d="M52 66 h16 M50 69 h20" stroke="currentColor" strokeOpacity={0.3} />
    </>
  ),
  pagoda: () => {
    // Une pagode à cinq toits : chaque étage un peu plus étroit, les égouts relevés, la flèche
    // (sōrin) et ses anneaux au sommet.
    const tiers = [0, 1, 2, 3, 4].map((i) => {
      const y = 64 - i * 10;
      const w = 46 - i * 5;
      return (
        <g key={i}>
          <rect x={60 - (9 - i)} y={y} width={2 * (9 - i)} height={i === 0 ? 4 : 6} fill={tint(0.2)} />
          {roof(60, y, w, 5, 0.5, `p${i}`)}
        </g>
      );
    });
    return (
      <>
        <rect x={44} y={68} width={32} height={4} fill={tint(0.25)} />
        {tiers}
        <path d="M60 23 V6" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.6} />
        <path d="M57 10 h6 M57 13 h6 M57 16 h6 M57 19 h6" stroke="currentColor" strokeOpacity={0.5} />
      </>
    );
  },
  castle: () => (
    // Une ville-château (Himeji, Odawara) : le socle de pierre aux flancs galbés, trois étages
    // de murs blancs sous des toits aux coins relevés, les shachihoko au faîte.
    <>
      <path d="M20 72 Q32 68 35 54 H85 Q88 68 100 72 Z" fill={tint(0.24)} />
      <path d="M30 64 H90 M33 58 H87 M48 54 L46 72 M64 54 V72 M80 54 L82 72" stroke="currentColor" strokeOpacity={0.15} />
      {wall(38, 42, 44, 12, 5)}
      {roof(60, 43, 60, 7, 0.55)}
      {wall(44, 30, 32, 10, 3)}
      {roof(60, 31, 46, 6, 0.55)}
      {wall(50, 19, 20, 9, 2)}
      {roof(60, 20, 32, 7, 0.6)}
      <path d="M51 13 q-1 -3 1 -4 M69 13 q1 -3 -1 -4" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.4} strokeLinecap="round" fill="none" />
    </>
  ),
  boats: () => (
    <>
      {waves(66)}
      <path d="M14 58 H52 L46 64 H20 Z" fill={tint(0.4)} />
      <path d="M32 58 V30 L48 52 Z" fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <path d="M66 54 H104 L98 60 H72 Z" fill={tint(0.32)} />
      <path d="M84 54 V32 L98 50 Z" fill={SNOW} stroke="currentColor" strokeOpacity={0.4} />
    </>
  ),
  kura: () => (
    <>
      <rect x={18} y={38} width={36} height={34} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <rect x={18} y={58} width={36} height={14} fill={tint(0.3)} />
      <path d="M14 38 L36 26 L58 38 Z" fill={tint(0.5)} />
      <rect x={66} y={44} width={34} height={28} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <rect x={66} y={60} width={34} height={12} fill={tint(0.3)} />
      <path d="M62 44 L83 33 L104 44 Z" fill={tint(0.5)} />
    </>
  ),
  watermill: () => (
    <>
      {waves(74)}
      <path d="M52 34 L76 22 L100 34 Z" fill={tint(0.4)} />
      <rect x={58} y={34} width={38} height={34} fill={tint(0.1)} stroke="currentColor" strokeOpacity={0.4} />
      <circle cx={42} cy={52} r={18} stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} fill="none" />
      <path d="M42 34 V70 M24 52 H60 M29 39 L55 65 M55 39 L29 65" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.2} />
    </>
  ),
  vines: () => (
    // Les vignes de Kai, en treille haute (tanazukuri) : la tonnelle de feuilles portée par des
    // piquets, les grappes qui pendent dessous.
    <>
      <path d="M14 72 V40 M44 72 V40 M74 72 V40 M104 72 V40" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.4} />
      <path d="M4 40 Q12 32 22 37 Q30 30 40 36 Q50 30 58 36 Q68 30 78 36 Q88 30 96 36 Q106 31 116 38 L116 42 H4 Z" fill={tint(0.24)} />
      <g fill={tint(0.4)}>
        {[26, 58, 90].map((x) => (
          <g key={x}>
            <circle cx={x - 2.4} cy={45} r={2.2} />
            <circle cx={x + 2.4} cy={45} r={2.2} />
            <circle cx={x} cy={48.6} r={2.2} />
            <circle cx={x} cy={52.2} r={1.8} />
          </g>
        ))}
      </g>
    </>
  ),
  orchard: () => (
    <g>
      {[24, 60, 96].map((x) => (
        <g key={x}>
          <path d={`M${x} 72 V56`} stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
          <circle cx={x} cy={48} r={11} fill={tint(0.22)} />
          <circle cx={x - 4} cy={46} r={1.6} fill={ACC} fillOpacity={0.7} />
          <circle cx={x + 4} cy={50} r={1.6} fill={ACC} fillOpacity={0.7} />
        </g>
      ))}
    </g>
  ),
  waterfall: () => (
    <>
      <path d="M30 72 L36 20 L52 16 L48 72 Z M72 72 L68 18 L86 22 L92 72 Z" fill={tint(0.18)} />
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
