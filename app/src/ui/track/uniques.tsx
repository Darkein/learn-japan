// Les illustrations uniques de la voie (SPEC §5c.6) : un lieu remarquable, son propre dessin,
// dans la place que la voie lui réserve. Même encre que les sprites (ui/track/sprites) : l'encre
// est `currentColor`, l'eau l'indigo, le vermillon l'accent, la neige `--decor-snow`.
//
// Deux formats : 300 × 200 pour une illustration que la voie contourne (elle prend un côté),
// 390 × 200 pour une illustration sur toute la largeur. Dans celles que la voie traverse (un
// gué, un bac, un pont), la bande d'eau de la traversée passe à mi-hauteur (y = 100) ; `rail`
// est l'abscisse de la voie, pour que les personnages et les bateaux s'en écartent.

import type { ReactNode } from "react";
import { UNIQUES, type DecorUnique, type UniqueKind } from "../../lib/scenery";
import { Sprite } from "./sprites";

const W = "var(--accent-2)";
const SNOW = "var(--decor-snow)";
const ACC = "var(--accent)";
const BG = "var(--bg)";

/** Une montagne : pied de x0 à x1 au sol `base`, sommet en (px, top). */
function mountain(x0: number, x1: number, base: number, px: number, top: number, opacity = 0.12, snowTo?: number): ReactNode {
  const k = `m${x0}:${px}:${top}`;
  const snow =
    snowTo !== undefined
      ? (() => {
          // La calotte : la pente coupée à la hauteur snowTo, bord dentelé.
          const l = px - ((px - x0) * (snowTo - top)) / (base - top);
          const r = px + ((x1 - px) * (snowTo - top)) / (base - top);
          const m = (l + r) / 2;
          return `M${l} ${snowTo} L${px - 4} ${top + 2} Q${px} ${top - 2} ${px + 4} ${top + 2} L${r} ${snowTo} L${(m + r) / 2} ${snowTo - 5} L${m} ${snowTo + 2} L${(l + m) / 2} ${snowTo - 5} Z`;
        })()
      : null;
  return (
    <g key={k}>
      <path d={`M${x0} ${base} L${px - 4} ${top + 2} Q${px} ${top - 2} ${px + 4} ${top + 2} L${x1} ${base} Z`} fill="currentColor" fillOpacity={opacity} />
      {snow && <path d={snow} fill={SNOW} stroke={W} strokeOpacity={0.3} strokeWidth={0.8} />}
    </g>
  );
}

/** Une étendue d'eau, de y0 à y1, avec ses lignes de vagues. */
function water(x0: number, x1: number, y0: number, y1: number, lines = 3): ReactNode {
  const out: ReactNode[] = [<rect key="w" x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={W} fillOpacity={0.14} />];
  for (let i = 0; i < lines; i++) {
    const y = y0 + ((i + 0.6) * (y1 - y0)) / (lines + 0.2);
    let d = `M${x0 + (i % 2) * 12} ${y}`;
    for (let x = x0 + (i % 2) * 12; x < x1 - 24; x += 24) d += " q6 -3.5 12 0 t12 0";
    out.push(<path key={`l${i}`} d={d} stroke={W} strokeOpacity={0.45} strokeWidth={1.1} fill="none" />);
  }
  return <g key={`water${y0}`}>{out}</g>;
}

/** Une silhouette de voyageur ou de porteur, debout en (x, y = pieds). */
function figure(x: number, y: number, s = 1, hat = true): ReactNode {
  return (
    <g key={`f${x}:${y}`} stroke="currentColor" strokeOpacity={0.65} strokeWidth={1.3 * s} strokeLinecap="round" fill="none">
      {hat ? <path d={`M${x - 4 * s} ${y - 15 * s} Q${x} ${y - 20 * s} ${x + 4 * s} ${y - 15 * s} Z`} fill="currentColor" fillOpacity={0.6} /> : <circle cx={x} cy={y - 16 * s} r={2 * s} fill="currentColor" fillOpacity={0.6} />}
      <path d={`M${x} ${y - 14 * s} V${y - 6 * s} M${x} ${y - 6 * s} l${-3 * s} ${6 * s} M${x} ${y - 6 * s} l${3 * s} ${6 * s} M${x - 3 * s} ${y - 11 * s} H${x + 3 * s}`} />
    </g>
  );
}

/** Une île de pins (Matsushima, Kisakata) : un rocher et deux ou trois pins. */
function pineIsle(x: number, y: number, s = 1): ReactNode {
  return (
    <g key={`i${x}:${y}`}>
      <path d={`M${x - 20 * s} ${y} Q${x - 14 * s} ${y - 12 * s} ${x} ${y - 13 * s} Q${x + 15 * s} ${y - 12 * s} ${x + 20 * s} ${y} Z`} fill="currentColor" fillOpacity={0.22} />
      <path d={`M${x - 24 * s} ${y + 1} Q${x} ${y + 5 * s} ${x + 24 * s} ${y + 1}`} stroke={W} strokeOpacity={0.5} fill="none" />
      <Sprite kind="pines" x={x - 30 * s} y={y - 50 * s} scale={0.5 * s} snowy={false} />
    </g>
  );
}

/** Un bateau à voile carrée, vu de côté, posé sur l'eau en (x, y). */
function sail(x: number, y: number, s = 1): ReactNode {
  return (
    <g key={`s${x}:${y}`}>
      <path d={`M${x - 16 * s} ${y - 4 * s} H${x + 16 * s} L${x + 11 * s} ${y + 2 * s} H${x - 11 * s} Z`} fill="currentColor" fillOpacity={0.45} />
      <rect x={x - 8 * s} y={y - 30 * s} width={16 * s} height={22 * s} fill={SNOW} stroke="currentColor" strokeOpacity={0.45} />
      <path d={`M${x} ${y - 32 * s} V${y - 4 * s} M${x - 8 * s} ${y - 23 * s} H${x + 8 * s} M${x - 8 * s} ${y - 16 * s} H${x + 8 * s}`} stroke="currentColor" strokeOpacity={0.45} />
    </g>
  );
}

/** Un pont en arc (Nihonbashi, Sanjō Ōhashi) de x0 à x1, tablier au plus haut en y. */
function archBridge(x0: number, x1: number, y: number, rise = 18): ReactNode {
  const m = (x0 + x1) / 2;
  const posts: string[] = [];
  for (let i = 1; i < 8; i++) {
    const x = x0 + ((x1 - x0) * i) / 8;
    const t = (x - x0) / (x1 - x0);
    const yy = y + rise - 4 * rise * t * (1 - t);
    posts.push(`M${x} ${yy} v-9`, `M${x} ${yy + 3} V${y + rise + 22}`);
  }
  return (
    <g key={`b${x0}`} fill="none" stroke="currentColor" strokeLinecap="round">
      <path d={`M${x0} ${y + rise} Q${m} ${y - rise} ${x1} ${y + rise}`} strokeOpacity={0.7} strokeWidth={3.2} />
      <path d={`M${x0} ${y + rise - 9} Q${m} ${y - rise - 9} ${x1} ${y + rise - 9}`} strokeOpacity={0.55} strokeWidth={1.3} />
      <path d={posts.join(" ")} strokeOpacity={0.45} strokeWidth={1.2} />
    </g>
  );
}

/** Ce qui s'écarte de la voie : à droite si la voie passe à gauche, et inversement. */
const away = (rail: number | undefined, left: number, right: number) => (rail !== undefined && rail > 195 ? left : right);

const ART: Record<UniqueKind, (rail?: number) => ReactNode> = {
  // Nihonbashi : le pont sur la rivière, les toits d'Edo, le château, le Fuji au loin.
  edo: () => (
    <>
      {mountain(300, 380, 70, 340, 30, 0.08, 42)}
      <Sprite kind="castle" x={150} y={6} scale={0.75} snowy={false} />
      <Sprite kind="roofs" x={10} y={40} scale={0.85} snowy={false} />
      <Sprite kind="roofs" x={110} y={50} scale={0.9} snowy={false} />
      <Sprite kind="roofs" x={250} y={44} scale={0.85} snowy={false} />
      {water(0, 390, 140, 200, 3)}
      {archBridge(60, 330, 112, 20)}
      {figure(150, 104, 0.9)}
      {figure(166, 102, 0.9)}
      {figure(250, 104, 0.9, false)}
      <Sprite kind="boats" x={300} y={150} scale={0.6} snowy={false} />
    </>
  ),
  // Hara : le Fuji si grand qu'il crève le cadre, au-dessus des marais d'Ukishima.
  "fuji-hara": () => (
    <>
      {mountain(10, 290, 150, 150, 0, 0.14, 46)}
      {mountain(0, 110, 150, 40, 100, 0.12)}
      {water(0, 300, 150, 176, 2)}
      <path d="M0 176 H300 V200 H0 Z" fill="currentColor" fillOpacity={0.08} />
      <path d="M20 176 v-10 M26 176 v-14 M32 176 v-8 M240 176 v-12 M246 176 v-16 M252 176 v-9" stroke="currentColor" strokeOpacity={0.45} />
      {/* Deux grues dans le marais. */}
      <g stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.4} strokeLinecap="round" fill="none">
        <path d="M110 186 v-14 M112 172 q4 -10 -2 -16 q-2 -2 2 -4" />
        <path d="M128 188 v-14 M130 174 q6 -8 0 -14" />
      </g>
      <circle cx={112} cy={152} r={1.6} fill={ACC} />
      {figure(200, 196, 1)}
      {figure(214, 196, 1)}
    </>
  ),
  // Le col de Satta : la falaise, la baie de Suruga, le Fuji par-dessus.
  "fuji-satta": () => (
    <>
      {mountain(60, 300, 120, 190, 20, 0.12, 52)}
      {water(0, 300, 110, 170, 3)}
      <path d="M0 60 Q40 70 70 110 Q90 140 80 200 H0 Z" fill="currentColor" fillOpacity={0.2} />
      <Sprite kind="pines" x={-6} y={22} scale={0.6} snowy={false} />
      {sail(170, 150, 0.8)}
      {sail(230, 140, 0.6)}
      {figure(52, 100, 0.9)}
      <path d="M0 200 Q120 180 300 196 V200 Z" fill="currentColor" fillOpacity={0.08} />
    </>
  ),
  // Hakone : les pics, le lac Ashi et son torii dans l'eau, le poste de contrôle.
  hakone: () => (
    <>
      {mountain(150, 280, 100, 230, 30, 0.07, 44)}
      <path d="M0 140 L30 40 L52 70 L80 10 L110 80 L130 50 L160 130 Z" fill="currentColor" fillOpacity={0.2} />
      <path d="M80 10 L92 46 L80 70 M30 40 L38 80" stroke="currentColor" strokeOpacity={0.3} fill="none" />
      {water(120, 300, 110, 170, 3)}
      <Sprite kind="lake-torii" x={180} y={92} scale={0.7} snowy={false} />
      <Sprite kind="gate" x={10} y={130} scale={0.6} snowy={false} />
      <Sprite kind="cedars" x={90} y={140} scale={0.55} snowy={false} />
      {figure(160, 196, 0.9)}
    </>
  ),
  // Le gué de l'Ōi : le large lit du fleuve, et les porteurs qui passent les voyageurs.
  "oi-ford": (rail) => {
    const x = away(rail, 80, 290);
    return (
      <>
        <path d="M0 0 H390 V48 Q290 40 195 52 T0 46 Z" fill="currentColor" fillOpacity={0.06} />
        <Sprite kind="pines" x={10} y={-14} scale={0.6} snowy={false} />
        <Sprite kind="pines" x={300} y={-10} scale={0.55} snowy={false} />
        {water(0, 390, 56, 146, 4)}
        <path d="M30 70 Q80 64 120 72 Q80 78 30 70 Z M250 132 Q300 124 350 134 Q300 140 250 132 Z" fill="currentColor" fillOpacity={0.1} />
        {/* Un palanquin sur une plate-forme, quatre porteurs dans l'eau. */}
        <rect x={x - 22} y={110} width={44} height={5} fill="currentColor" fillOpacity={0.5} />
        <path d={`M${x - 12} 110 V96 H${x + 12} V110 M${x - 14} 96 Q${x} 88 ${x + 14} 96`} stroke="currentColor" strokeOpacity={0.6} fill="currentColor" fillOpacity={0.15} />
        {[x - 18, x - 6, x + 6, x + 18].map((px) => figure(px, 130, 0.9, false))}
        {figure(x - 50, 70, 0.9, false)}
        {figure(x - 40, 74, 0.8)}
        <path d="M0 152 Q195 146 390 154 V200 H0 Z" fill="currentColor" fillOpacity={0.06} />
        <Sprite kind="teahouse" x={x > 195 ? 10 : 290} y={140} scale={0.55} snowy={false} />
      </>
    );
  },
  // Le lac Hamana : la traversée en bateau de Maisaka à Arai, les bancs de sable, les pins.
  hamana: (rail) => (
    <>
      <path d="M0 0 H390 V40 Q290 52 195 42 T0 48 Z" fill="currentColor" fillOpacity={0.07} />
      <Sprite kind="gate" x={away(rail, 30, 250)} y={-12} scale={0.55} snowy={false} />
      {water(0, 390, 46, 156, 5)}
      {pineIsle(away(rail, 70, 300), 70, 0.8)}
      {pineIsle(away(rail, 120, 250), 140, 0.7)}
      {sail(away(rail, 40, 340), 130, 0.6)}
      <path d="M0 160 Q195 152 390 162 V200 H0 Z" fill="currentColor" fillOpacity={0.07} />
      <Sprite kind="pines" x={away(rail, 20, 280)} y={128} scale={0.55} snowy={false} />
    </>
  ),
  // Les sept ri en mer : du torii d'Atsuta à Miya jusqu'au château de Kuwana.
  "miya-ferry": (rail) => (
    <>
      <path d="M0 0 H390 V34 Q290 44 195 36 T0 40 Z" fill="currentColor" fillOpacity={0.07} />
      <Sprite kind="torii" x={away(rail, 20, 290)} y={-14} scale={0.5} snowy={false} />
      {water(0, 390, 38, 166, 6)}
      {sail(away(rail, 60, 300), 70, 0.8)}
      {sail(away(rail, 110, 250), 140, 0.7)}
      {sail(away(rail, 30, 350), 120, 0.5)}
      <path d="M0 166 Q195 160 390 170 V200 H0 Z" fill="currentColor" fillOpacity={0.07} />
      <Sprite kind="castle" x={away(rail, 30, 260)} y={140} scale={0.6} snowy={false} />
    </>
  ),
  // Kyōto : le pont de Sanjō sur la Kamo, les collines de Higashiyama et la pagode de Yasaka.
  kyoto: () => (
    <>
      <path d="M0 90 Q50 40 110 60 Q170 20 230 50 Q270 30 300 50 V120 H0 Z" fill="currentColor" fillOpacity={0.09} />
      <Sprite kind="pagoda" x={150} y={14} scale={1} snowy={false} />
      <Sprite kind="temple" x={40} y={50} scale={0.6} snowy={false} />
      <Sprite kind="roofs" x={200} y={66} scale={0.7} snowy={false} />
      {water(0, 300, 150, 200, 2)}
      {archBridge(20, 280, 128, 12)}
      {figure(110, 124, 0.9)}
      {figure(124, 123, 0.9, false)}
      {figure(196, 124, 0.9)}
    </>
  ),
  // Saruhashi : la gorge de la Katsura, ses falaises, et les consoles du pont-singe.
  saruhashi: (rail) => {
    const x = rail ?? 195;
    return (
      <>
        <path d="M0 0 H390 V76 Q300 66 220 74 T0 70 Z" fill="currentColor" fillOpacity={0.22} />
        <path d="M0 200 H390 V124 Q300 134 220 126 T0 130 Z" fill="currentColor" fillOpacity={0.22} />
        <path d="M30 20 L50 60 M120 10 L110 66 M290 30 L310 64 M60 190 L80 140 M300 186 L280 134" stroke="currentColor" strokeOpacity={0.25} />
        <Sprite kind="pines" x={away(rail, 10, 290)} y={-24} scale={0.6} snowy={false} />
        <Sprite kind="cedars" x={away(rail, 30, 270)} y={140} scale={0.55} snowy={false} />
        {water(0, 390, 82, 118, 2)}
        {/* Les consoles empilées qui portent le pont, de chaque côté de la gorge. */}
        <g fill="currentColor" fillOpacity={0.5}>
          {[0, 1, 2, 3].map((k) => (
            <g key={k}>
              <rect x={x - 26 + k * 2} y={72 - k * 5} width={52 - k * 4} height={4} />
              <rect x={x - 26 + k * 2} y={124 + k * 5} width={52 - k * 4} height={4} />
            </g>
          ))}
        </g>
      </>
    );
  },
  // Le bassin de Kai : les vignes, la plaine, le Fuji par-dessus les monts.
  kai: () => (
    <>
      {mountain(90, 270, 90, 180, 10, 0.12, 36)}
      <path d="M0 100 L40 50 L80 80 L120 54 L160 90 L210 60 L250 84 L300 56 V110 H0 Z" fill="currentColor" fillOpacity={0.14} />
      <path d="M0 110 H300 V130 H0 Z" fill="currentColor" fillOpacity={0.05} />
      <Sprite kind="vines" x={0} y={120} scale={0.8} snowy={false} />
      <Sprite kind="vines" x={100} y={124} scale={0.8} snowy={false} />
      <Sprite kind="vines" x={200} y={120} scale={0.8} snowy={false} />
      {figure(150, 196, 0.9)}
    </>
  ),
  // Le lac Suwa, le château de Takashima sur sa rive, les monts autour.
  suwa: () => (
    <>
      <path d="M0 80 L50 30 L90 60 L140 20 L190 56 L240 26 L300 70 V100 H0 Z" fill="currentColor" fillOpacity={0.12} />
      <ellipse cx={150} cy={130} rx={150} ry={40} fill={W} fillOpacity={0.14} />
      {water(30, 270, 110, 150, 2)}
      <Sprite kind="castle" x={10} y={120} scale={0.65} snowy={false} />
      {sail(200, 132, 0.6)}
      <Sprite kind="pines" x={200} y={140} scale={0.55} snowy={false} />
    </>
  ),
  // Le col d'Usui et l'Asama qui fume, au-dessus des cèdres.
  "usui-asama": () => (
    <>
      <Sprite kind="volcano" x={60} y={-10} scale={1.6} snowy={false} />
      <path d="M0 160 Q40 100 90 120 Q140 90 190 124 Q240 96 300 130 V200 H0 Z" fill="currentColor" fillOpacity={0.14} />
      <Sprite kind="cedars" x={0} y={116} scale={0.7} snowy={false} />
      <Sprite kind="cedars" x={200} y={120} scale={0.7} snowy={false} />
      <Sprite kind="gate" x={110} y={136} scale={0.5} snowy={false} />
      {figure(160, 194, 0.9)}
    </>
  ),
  // Le col de Magome : Tsumago et Magome, maisons en gradins sur la pente, la forêt du Kiso.
  kiso: () => (
    <>
      <path d="M0 70 L60 20 L110 50 L170 10 L230 46 L300 16 V90 H0 Z" fill="currentColor" fillOpacity={0.1} />
      <Sprite kind="cedars" x={0} y={40} scale={0.8} snowy={false} />
      <Sprite kind="cedars" x={210} y={36} scale={0.8} snowy={false} />
      <path d="M40 200 Q120 150 160 120 Q190 98 260 80" stroke="currentColor" strokeOpacity={0.35} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Sprite kind="town" x={150} y={66} scale={0.6} snowy={false} />
      <Sprite kind="town" x={90} y={104} scale={0.6} snowy={false} />
      <Sprite kind="town" x={30} y={140} scale={0.6} snowy={false} />
      {figure(200, 140, 0.8)}
    </>
  ),
  // Le lac Biwa, le pin de Karasaki, les voiles, les monts Hira au loin.
  biwa: () => (
    <>
      <path d="M0 60 L60 24 L120 50 L180 20 L240 46 L300 30 V80 H0 Z" fill="currentColor" fillOpacity={0.08} />
      {water(0, 300, 80, 170, 4)}
      {sail(150, 120, 0.7)}
      {sail(220, 104, 0.5)}
      <g>
        <path d="M30 196 Q36 160 60 140 Q80 126 110 130" stroke="currentColor" strokeOpacity={0.6} strokeWidth={4} fill="none" strokeLinecap="round" />
        <g fill="currentColor" fillOpacity={0.35}>
          <ellipse cx={70} cy={130} rx={30} ry={7} />
          <ellipse cx={110} cy={124} rx={24} ry={6} />
          <ellipse cx={40} cy={148} rx={20} ry={6} />
        </g>
        <path d="M60 140 v56 M104 130 v66" stroke="currentColor" strokeOpacity={0.4} strokeDasharray="2 4" />
      </g>
    </>
  ),
  // Fukagawa : l'ermitage du bananier, la Sumida, la barque du départ de Bashō.
  fukagawa: () => (
    <>
      <path d="M0 0 H390 V110 Q300 100 200 108 T0 104 Z" fill="currentColor" fillOpacity={0.05} />
      <path d="M90 90 L120 64 H170 L196 90 Z" fill="currentColor" fillOpacity={0.3} />
      <rect x={104} y={90} width={80} height={30} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.4} />
      {/* Le bananier (bashō) qui donna son nom au poète. */}
      <g stroke="currentColor" strokeOpacity={0.55} strokeWidth={1.4} fill="currentColor" fillOpacity={0.18}>
        <path d="M230 120 V70" fill="none" />
        <path d="M230 74 Q200 60 196 40 Q220 50 230 74 Z M230 70 Q260 50 270 30 Q250 58 230 70 Z M230 86 Q262 82 280 66 Q262 92 230 86 Z" />
      </g>
      {water(0, 390, 130, 200, 3)}
      <path d="M150 160 H230 L220 168 H160 Z" fill="currentColor" fillOpacity={0.45} />
      {figure(176, 160, 0.9)}
      {figure(196, 160, 0.9, false)}
      <path d="M220 160 L250 130" stroke="currentColor" strokeOpacity={0.5} />
      <Sprite kind="bridge" x={290} y={110} scale={0.7} snowy={false} />
    </>
  ),
  // Nikkō : le Tōshō-gū et sa pagode dans les cèdres, le pont sacré Shinkyō.
  nikko: () => (
    <>
      <Sprite kind="cedars" x={0} y={-10} scale={1.1} snowy={false} />
      <Sprite kind="cedars" x={170} y={-6} scale={1.1} snowy={false} />
      <Sprite kind="pagoda" x={80} y={0} scale={0.9} snowy={false} />
      <Sprite kind="shrine" x={160} y={60} scale={0.7} snowy={false} />
      {water(0, 300, 140, 200, 2)}
      <g fill="none" stroke={ACC} strokeLinecap="round">
        <path d="M60 156 Q150 124 240 156" strokeWidth={4} />
        <path d="M66 148 Q150 116 234 148" strokeWidth={1.6} />
        <path d="M90 146 v10 M120 138 v10 M150 134 v10 M180 138 v10 M210 146 v10" strokeWidth={1.4} />
      </g>
    </>
  ),
  // Matsushima : la baie aux îles de pins.
  matsushima: () => (
    <>
      {water(0, 300, 40, 200, 6)}
      {pineIsle(60, 80, 1)}
      {pineIsle(170, 64, 0.8)}
      {pineIsle(250, 110, 1.1)}
      {pineIsle(110, 150, 0.9)}
      {pineIsle(220, 180, 0.7)}
      {sail(40, 186, 0.5)}
    </>
  ),
  // Hiraizumi : le pavillon d'or du Chūson-ji sur sa colline, la Kitakami, les herbes d'été.
  hiraizumi: () => (
    <>
      <path d="M0 120 Q80 40 160 60 Q230 70 300 110 V140 H0 Z" fill="currentColor" fillOpacity={0.12} />
      <Sprite kind="cedars" x={20} y={26} scale={0.7} snowy={false} />
      <Sprite kind="cedars" x={190} y={34} scale={0.7} snowy={false} />
      <Sprite kind="temple" x={100} y={26} scale={0.8} snowy={false} />
      {water(0, 300, 140, 172, 2)}
      <path d="M10 196 q4 -14 2 -22 M18 196 q-2 -12 4 -20 M120 198 q4 -14 2 -22 M128 198 q-2 -12 4 -20 M240 196 q4 -14 2 -22 M248 196 q-2 -12 4 -20" stroke="currentColor" strokeOpacity={0.45} fill="none" />
    </>
  ),
  // Yamadera : les pavillons accrochés à la falaise, l'escalier, les cèdres.
  yamadera: () => (
    <>
      <path d="M40 200 L60 120 L90 60 L130 20 L190 10 L230 50 L270 110 L300 200 Z" fill="currentColor" fillOpacity={0.16} />
      <path d="M90 60 L110 110 M190 10 L180 70 M230 50 L220 120" stroke="currentColor" strokeOpacity={0.3} fill="none" />
      <Sprite kind="temple" x={150} y={-2} scale={0.5} snowy={false} />
      <Sprite kind="shrine" x={80} y={50} scale={0.45} snowy={false} />
      <Sprite kind="temple" x={200} y={70} scale={0.45} snowy={false} />
      <path d="M120 200 Q130 160 150 140 Q170 120 180 40" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.4} strokeDasharray="3 3" fill="none" />
      <Sprite kind="cedars" x={0} y={130} scale={0.65} snowy={false} />
      <Sprite kind="cedars" x={220} y={134} scale={0.65} snowy={false} />
    </>
  ),
  // Kisakata : la lagune aux îles, sous le mont Chōkai enneigé.
  kisakata: () => (
    <>
      {mountain(60, 300, 100, 190, 16, 0.12, 40)}
      {water(0, 300, 100, 200, 4)}
      {pineIsle(60, 130, 0.8)}
      {pineIsle(150, 150, 1)}
      {pineIsle(250, 176, 0.8)}
      {sail(230, 126, 0.5)}
    </>
  ),
  // Ōgaki : le château, le canal, et la barque où Bashō repart pour Ise.
  ogaki: () => (
    <>
      <Sprite kind="castle" x={150} y={10} scale={1} snowy={false} />
      <Sprite kind="pines" x={20} y={30} scale={0.6} snowy={false} />
      <path d="M0 110 H300 V118 H0 Z" fill="currentColor" fillOpacity={0.12} />
      {water(0, 300, 118, 200, 3)}
      <path d="M90 160 H170 L162 168 H98 Z" fill="currentColor" fillOpacity={0.45} />
      {figure(120, 160, 0.9)}
      <path d="M160 160 L186 132" stroke="currentColor" strokeOpacity={0.5} />
      <Sprite kind="sakura" x={200} y={60} scale={0.7} snowy={false} />
    </>
  ),
  // Le détroit de Naruto et ses tourbillons.
  naruto: () => (
    <>
      <path d="M0 0 H130 Q110 40 60 50 Q20 56 0 80 Z" fill="currentColor" fillOpacity={0.18} />
      <path d="M390 0 H270 Q290 30 330 44 Q370 54 390 80 Z" fill="currentColor" fillOpacity={0.18} />
      <Sprite kind="pines" x={0} y={-20} scale={0.6} snowy={false} />
      <Sprite kind="pines" x={300} y={-20} scale={0.6} snowy={false} />
      {water(0, 390, 60, 200, 3)}
      {[
        [130, 120, 30],
        [250, 100, 22],
        [200, 160, 18],
        [80, 170, 14],
      ].map(([x, y, r]) => (
        <path
          key={`${x}`}
          d={`M${x + r} ${y} A${r} ${r * 0.45} 0 1 0 ${x} ${y + r * 0.45} A${r * 0.7} ${r * 0.32} 0 1 0 ${x + r * 0.5} ${y - r * 0.1} A${r * 0.35} ${r * 0.16} 0 1 0 ${x} ${y}`}
          stroke={W}
          strokeOpacity={0.6}
          strokeWidth={1.4}
          fill="none"
        />
      ))}
      {sail(320, 150, 0.6)}
    </>
  ),
  // Le cap Muroto : les rochers dans les vagues, la grotte de Kūkai, le temple en haut.
  muroto: () => (
    <>
      <path d="M0 0 H200 Q190 60 150 100 Q120 130 130 200 H0 Z" fill="currentColor" fillOpacity={0.18} />
      <Sprite kind="temple" x={40} y={6} scale={0.6} snowy={false} />
      <path d="M70 150 Q80 128 96 150 Z" fill={BG} stroke="currentColor" strokeOpacity={0.5} />
      {water(130, 300, 60, 200, 5)}
      <path d="M180 140 L196 120 L210 140 Z M230 170 L244 150 L260 172 Z" fill="currentColor" fillOpacity={0.3} />
      <path d="M170 142 q10 -10 22 -2 M222 172 q10 -10 22 -2" stroke={SNOW} strokeWidth={2} fill="none" />
      {figure(110, 196, 0.9)}
    </>
  ),
  // Les gorges d'Iya et leur pont de lianes.
  iya: () => (
    <>
      <path d="M0 0 H90 L110 200 H0 Z" fill="currentColor" fillOpacity={0.2} />
      <path d="M300 0 H210 L190 200 H300 Z" fill="currentColor" fillOpacity={0.2} />
      {water(100, 200, 150, 200, 2)}
      <g stroke="currentColor" strokeOpacity={0.6} fill="none" strokeLinecap="round">
        <path d="M90 70 Q150 120 210 70" strokeWidth={2} />
        <path d="M90 50 Q150 100 210 50" strokeWidth={1.4} />
        <path d="M105 60 v12 M120 70 v14 M135 78 v14 M150 80 v15 M165 78 v14 M180 70 v14 M195 60 v12" strokeWidth={1} />
      </g>
      <Sprite kind="cedars" x={0} y={0} scale={0.7} snowy={false} />
      <Sprite kind="cedars" x={210} y={10} scale={0.7} snowy={false} />
      {figure(150, 92, 0.8)}
    </>
  ),
  // Le Zentsū-ji : la grande pagode à cinq toits et les camphriers.
  zentsuji: () => (
    <>
      <Sprite kind="pagoda" x={80} y={-24} scale={1.5} snowy={false} />
      <g fill="currentColor" fillOpacity={0.22}>
        <circle cx={40} cy={120} r={36} />
        <circle cx={262} cy={116} r={34} />
      </g>
      <path d="M40 200 V140 M262 200 V140" stroke="currentColor" strokeOpacity={0.5} strokeWidth={4} />
      <Sprite kind="temple" x={150} y={120} scale={0.7} snowy={false} />
      {figure(110, 196, 0.9)}
    </>
  ),
  // L'Ōkubo-ji : le dernier temple dans la forêt, où l'on laisse son bâton de pèlerin.
  okuboji: () => (
    <>
      <path d="M0 90 L60 30 L120 70 L180 20 L240 60 L300 30 V120 H0 Z" fill="currentColor" fillOpacity={0.1} />
      <Sprite kind="cedars" x={0} y={60} scale={0.8} snowy={false} />
      <Sprite kind="cedars" x={200} y={56} scale={0.8} snowy={false} />
      <Sprite kind="temple" x={90} y={70} scale={0.9} snowy={false} />
      {/* Les bâtons laissés, en faisceau. */}
      <path d="M150 200 L144 150 M154 200 L152 148 M158 200 L160 150 M162 200 L168 152" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.6} />
      {figure(200, 196, 0.9)}
    </>
  ),
};

/** Le format d'une illustration : 390 de large sur toute la largeur, 300 à côté de la voie. */
function viewWidth(kind: UniqueKind): number {
  return UNIQUES[kind].around ? 300 : 390;
}

/**
 * Une illustration unique dans sa boîte, à l'échelle (proportions gardées, centrée).
 * `railX` : l'abscisse de la voie qui la traverse, s'il y en a une.
 */
export function UniqueArt({ unique, railX }: { unique: DecorUnique; railX?: number }) {
  const { box, kind } = unique;
  const vw = viewWidth(kind);
  const s = Math.min(box.w / vw, box.h / 200);
  const ox = box.x + (box.w - vw * s) / 2;
  const oy = box.y + (box.h - 200 * s) / 2;
  const rail = railX === undefined ? undefined : (railX - ox) / s;
  return (
    <g transform={`translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${s.toFixed(3)})`}>
      <svg width={vw} height={200} overflow="hidden">
        {ART[kind](rail)}
      </svg>
    </g>
  );
}
