// Les illustrations uniques de la voie (SPEC §5c.6) : un lieu remarquable, son propre dessin,
// dans la place que la voie lui réserve. Même encre que les sprites (ui/track/sprites) : l'encre
// est `currentColor`, l'eau l'indigo, le vermillon l'accent, la neige `--decor-snow`.
//
// Deux formats : 300 × 200 pour une illustration que la voie contourne (elle prend un côté),
// 390 × 200 pour une illustration sur toute la largeur. Dans celles que la voie traverse (un
// gué, un bac, un pont), la bande d'eau de la traversée passe à mi-hauteur (y = 100) ; `rail`
// est l'abscisse de la voie, pour que les personnages et les bateaux s'en écartent.
//
// Les plans (monts, eau, rives) sont peints à plat, opaques (`tint`) : chacun cache ce qu'il
// recouvre, sans qu'on voie ses bords en transparence. Aucun ne s'arrête sur un bord droit de
// la boîte : les monts retombent à leur pied, l'eau a ses rives, la terre s'effile.

import type { ReactNode } from "react";
import { UNIQUES, type DecorUnique, type UniqueKind } from "../../lib/scenery";
import { Sprite } from "./sprites";

const W = "var(--accent-2)";
const SNOW = "var(--decor-snow)";
const ACC = "var(--accent)";
const BG = "var(--bg)";

/** L'encre ou l'eau diluée sur le papier, mais opaque : `o` est la part de couleur. */
const tint = (o: number, c = "currentColor") => `color-mix(in srgb, ${c} ${Math.round(o * 100)}%, var(--bg))`;

/**
 * La même teinte qui se perd dans la brume vers le bas : les monts et les collines n'ont pas
 * de pied tranché. Les dégradés sont déclarés une fois par illustration (`MistDefs`).
 */
const mist = (o: number) => `url(#mist-${Math.round(o * 100)})`;
const MIST_LEVELS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30];

function MistDefs() {
  return (
    <defs>
      {MIST_LEVELS.map((o) => (
        <linearGradient key={o} id={`mist-${o}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor={tint(o / 100)} />
          <stop offset="1" stopColor={BG} />
        </linearGradient>
      ))}
    </defs>
  );
}

type Pt = [number, number];

/** Le point de la courbe a → (contrôle c) → b, à t. */
function qAt(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
}

/** Le contrôle d'un versant de a à b : creusé sous la corde, comme une pente qui s'adoucit au pied. */
function slope(a: Pt, b: Pt): Pt {
  const low = a[1] > b[1] ? a : b;
  const high = low === a ? b : a;
  return [high[0] + (low[0] - high[0]) * 0.55, low[1] - (low[1] - high[1]) * 0.18];
}

/**
 * Une chaîne de monts : du pied (x0, base) au pied (x1, base), par les sommets et les cols
 * donnés. Les versants sont creusés ; `snow` coiffe de neige les sommets plus hauts que lui.
 */
function range(x0: number, x1: number, base: number, tops: Pt[], o: number, snow?: number): ReactNode {
  const pts: Pt[] = [[x0, base], ...tops, [x1, base]];
  let d = `M${x0} ${base}`;
  const caps: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const c = slope(pts[i - 1], pts[i]);
    d += ` Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${pts[i][0]} ${pts[i][1]}`;
  }
  if (snow !== undefined) {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (p[1] >= snow || p[1] > pts[i - 1][1] || p[1] > pts[i + 1][1]) continue;
      // Les bords de la calotte : là où chaque versant descend sous la ligne de neige.
      const up = slope(pts[i - 1], p);
      const down = slope(p, pts[i + 1]);
      let tl = 1;
      while (tl > 0 && qAt(pts[i - 1], up, p, tl)[1] < snow) tl -= 0.02;
      let tr = 0;
      while (tr < 1 && qAt(p, down, pts[i + 1], tr)[1] < snow) tr += 0.02;
      const l = qAt(pts[i - 1], up, p, tl);
      const r = qAt(p, down, pts[i + 1], tr);
      const y = Math.max(l[1], r[1]);
      const ml = qAt(pts[i - 1], up, p, (tl + 2) / 3);
      const mr = qAt(p, down, pts[i + 1], tr / 3);
      const f = (q: Pt) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      caps.push(
        `M${f(l)} Q${f(ml)} ${p[0]} ${p[1]} Q${f(mr)} ${f(r)} L${((r[0] * 2 + p[0]) / 3).toFixed(1)} ${(y - 6).toFixed(1)} L${p[0]} ${y.toFixed(1)} L${((l[0] * 2 + p[0]) / 3).toFixed(1)} ${(y - 6).toFixed(1)} Z`,
      );
    }
  }
  return (
    <g key={`r${x0}:${base}:${tops[0]?.[0]}`}>
      <path d={`${d} Z`} fill={mist(o)} />
      {caps.length > 0 && <path d={caps.join(" ")} fill={SNOW} stroke={W} strokeOpacity={0.3} strokeWidth={0.8} strokeLinejoin="round" />}
    </g>
  );
}

/** Des collines rondes : du pied (x0, base) au pied (x1, base), arrondies sous les points donnés. */
function hills(x0: number, x1: number, base: number, tops: Pt[], o: number): ReactNode {
  const pts: Pt[] = [[x0, base], ...tops, [x1, base]];
  let d = `M${x0} ${base}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const n = pts[i + 1];
    const end: Pt = i === pts.length - 2 ? n : [(pts[i][0] + n[0]) / 2, (pts[i][1] + n[1]) / 2];
    d += ` Q${pts[i][0]} ${pts[i][1]} ${end[0]} ${end[1]}`;
  }
  return <path key={`h${x0}:${base}`} d={`${d} Z`} fill={mist(o)} />;
}

/** Une ligne de vaguelettes de x0 à x1 à la hauteur y. */
function ripple(x0: number, x1: number, y: number): string {
  let d = `M${x0.toFixed(1)} ${y.toFixed(1)}`;
  for (let x = x0; x <= x1 - 12; x += 12) d += " q3 -2.4 6 0 t6 0";
  return d;
}

/**
 * Une étendue d'eau de x0 à x1, de y0 à y1, et ses vaguelettes. Ses bouts s'arrondissent en
 * rive, sauf ceux qui touchent le bord de la voie (`open`) : la rivière continue au-delà.
 */
function water(x0: number, x1: number, y0: number, y1: number, lines = 3, open: "none" | "left" | "right" | "both" = "none"): ReactNode {
  const ol = open === "left" || open === "both";
  const or = open === "right" || open === "both";
  const h = y1 - y0;
  const w = x1 - x0;
  const m = (x0 + x1) / 2;
  // Vue de biais : la rive du fond presque droite, effilée aux deux bouts ; celle de devant
  // ample et un peu bosselée. Un bout ouvert continue tout droit au-delà du bord.
  const d = [
    ol ? `M${x0 - 4} ${y0}` : `M${x0} ${y0 + h * 0.3} Q${x0 + w * 0.12} ${y0} ${x0 + w * 0.3} ${y0}`,
    `Q${m - w * 0.1} ${y0 - 2} ${m} ${y0} T${or ? x1 + 4 : x1 - w * 0.3} ${y0}`,
    or ? `V${y1}` : `Q${x1 - w * 0.12} ${y0} ${x1} ${y0 + h * 0.26} C${x1 - w * 0.08} ${y1 - h * 0.12} ${x1 - w * 0.22} ${y1} ${m + w * 0.12} ${y1}`,
    `Q${m} ${y1 + 3} ${m - w * 0.14} ${y1 - 1}`,
    ol ? `L${x0 - 4} ${y1} Z` : `C${x0 + w * 0.2} ${y1 - 2} ${x0 + w * 0.06} ${y1 - h * 0.18} ${x0} ${y0 + h * 0.3} Z`,
  ].join(" ");
  const out: ReactNode[] = [<path key="w" d={d} fill={tint(0.16, W)} />];
  // Les vaguelettes : des traits courts, en quinconce, plus courts près des rives arrondies.
  for (let i = 0; i < lines; i++) {
    const t = (i + 0.7) / (lines + 0.4);
    const y = y0 + h * t;
    const a = ol ? x0 : x0 + w * (0.22 - 0.12 * t);
    const b = or ? x1 : x1 - w * (0.24 - 0.12 * t);
    const seg = 54;
    let d2 = "";
    for (let x = a + ((i * 29) % seg); x < b - 20; x += seg + 18) d2 += ripple(x, Math.min(b, x + seg), y) + " ";
    if (d2) out.push(<path key={`l${i}`} d={d2} stroke={W} strokeOpacity={0.5} strokeWidth={1.1} fill="none" />);
  }
  return <g key={`water${x0}:${y0}`}>{out}</g>;
}

/**
 * Une terre qui s'effile : sa crête de x0 à x1 culmine à y, ses bouts retombent à y + h.
 * Pour les rives et les replats.
 */
function bank(x0: number, x1: number, y: number, h: number, o: number): ReactNode {
  const m = (x0 + x1) / 2;
  return (
    <path
      key={`b${x0}:${y}`}
      d={`M${x0} ${y + h} Q${x0 + (x1 - x0) * 0.18} ${y} ${m} ${y} T${x1} ${y + h} Q${m} ${y + h + 4} ${x0} ${y + h} Z`}
      fill={tint(o)}
    />
  );
}

/** Une touffe de roseaux ou d'herbes au pied (x, y). */
function reeds(x: number, y: number, s = 1): ReactNode {
  return (
    <path
      key={`rd${x}:${y}`}
      d={`M${x} ${y} q${-1 * s} ${-9 * s} ${-4 * s} ${-14 * s} M${x + 3 * s} ${y} q0 ${-10 * s} ${3 * s} ${-16 * s} M${x + 6 * s} ${y} q${1 * s} ${-6 * s} ${5 * s} ${-10 * s}`}
      stroke="currentColor"
      strokeOpacity={0.45}
      strokeWidth={1.1}
      strokeLinecap="round"
      fill="none"
    />
  );
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
      <Sprite kind="pines" x={x - 30 * s} y={y - 50 * s} scale={0.5 * s} snowy={false} />
      <path d={`M${x - 22 * s} ${y} Q${x - 16 * s} ${y - 9 * s} ${x - 4 * s} ${y - 11 * s} Q${x + 12 * s} ${y - 12 * s} ${x + 22 * s} ${y} Z`} fill={tint(0.28)} />
      <path d={`M${x - 26 * s} ${y + 2} q${6 * s} -2 ${12 * s} 0 M${x + 12 * s} ${y + 2} q${6 * s} -2 ${12 * s} 0`} stroke={W} strokeOpacity={0.55} fill="none" />
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

/** Une barque plate (Sumida, canal d'Ōgaki), posée sur l'eau en (x, y), sa perche. */
function punt(x: number, y: number, w = 80): ReactNode {
  return (
    <g key={`p${x}:${y}`}>
      <path d={`M${x} ${y} H${x + w} L${x + w - 10} ${y + 7} H${x + 8} Z`} fill="currentColor" fillOpacity={0.45} />
      <path d={`M${x + w - 12} ${y + 12} L${x + w + 14} ${y - 30}`} stroke="currentColor" strokeOpacity={0.5} />
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

/** Un grand arbre à frondaison en nuage (camphrier) : tronc épais et ramifié, houppier lobé. */
function bigTree(x: number, foot: number, s = 1): ReactNode {
  const lobes: [number, number, number][] = [
    [-30, -62, 22], [-8, -76, 26], [20, -70, 24], [36, -54, 18], [-40, -46, 16], [4, -52, 24],
  ];
  return (
    <g key={`tree${x}`}>
      <g fill={tint(0.2)}>
        {lobes.map(([dx, dy, r], i) => (
          <circle key={i} cx={x + dx * s} cy={foot + dy * s} r={r * s} />
        ))}
      </g>
      <path
        d={`M${x - 7 * s} ${foot} Q${x - 4 * s} ${foot - 30 * s} ${x - 18 * s} ${foot - 46 * s} M${x - 2 * s} ${foot - 30 * s} Q${x + 6 * s} ${foot - 44 * s} ${x + 20 * s} ${foot - 52 * s} M${x + 7 * s} ${foot} Q${x + 3 * s} ${foot - 24 * s} ${x} ${foot - 56 * s}`}
        stroke={tint(0.5)}
        strokeWidth={5 * s}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

/** Ce qui s'écarte de la voie : à droite si la voie passe à gauche, et inversement. */
const away = (rail: number | undefined, left: number, right: number) => (rail !== undefined && rail > 195 ? left : right);

const ART: Record<UniqueKind, (rail?: number) => ReactNode> = {
  // Nihonbashi : le pont sur la rivière, les toits d'Edo, le château, le Fuji au loin.
  edo: () => (
    <>
      {range(296, 388, 70, [[342, 30]], 0.1, 44)}
      {hills(110, 290, 70, [[200, 50]], 0.07)}
      <Sprite kind="castle" x={150} y={6} scale={0.75} snowy={false} />
      {bank(-30, 420, 100, 40, 0.06)}
      <Sprite kind="roofs" x={10} y={40} scale={0.85} snowy={false} />
      <Sprite kind="roofs" x={110} y={50} scale={0.9} snowy={false} />
      <Sprite kind="roofs" x={250} y={44} scale={0.85} snowy={false} />
      {water(0, 390, 138, 192, 3, "both")}
      {archBridge(60, 330, 112, 20)}
      {figure(150, 104, 0.9)}
      {figure(166, 102, 0.9)}
      {figure(250, 104, 0.9, false)}
      <Sprite kind="boats" x={300} y={140} scale={0.6} snowy={false} />
    </>
  ),
  // Hara : le Fuji si grand qu'il crève le cadre, au-dessus des marais d'Ukishima.
  "fuji-hara": () => (
    <>
      {range(14, 286, 156, [[150, 6]], 0.15, 52)}
      {range(0, 124, 156, [[44, 106], [70, 116], [90, 112]], 0.22)}
      {water(16, 284, 148, 178, 2)}
      {bank(0, 300, 172, 24, 0.1)}
      {reeds(22, 180)}
      {reeds(250, 178)}
      {reeds(266, 182, 0.8)}
      {/* Deux grues dans le marais. */}
      <g stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.4} strokeLinecap="round" fill="none">
        <path d="M110 176 v-14 M112 162 q4 -10 -2 -16 q-2 -2 2 -4" />
        <path d="M128 178 v-14 M130 164 q6 -8 0 -14" />
      </g>
      <circle cx={112} cy={142} r={1.6} fill={ACC} />
      {figure(196, 190, 1)}
      {figure(210, 190, 1)}
    </>
  ),
  // Le col de Satta : le promontoire et son sentier, la baie de Suruga, le Fuji par-dessus.
  "fuji-satta": () => (
    <>
      {range(84, 296, 118, [[192, 18]], 0.13, 56)}
      {water(30, 292, 108, 168, 3)}
      {sail(200, 140, 0.8)}
      {sail(254, 128, 0.6)}
      <path d="M8 196 Q12 128 30 92 Q48 58 84 56 Q114 58 124 90 Q132 130 160 196 Q84 204 8 196 Z" fill={mist(0.24)} />
      <Sprite kind="pines" x={24} y={14} scale={0.6} snowy={false} />
      <path d="M40 196 Q64 150 74 112 Q84 84 108 76" stroke={BG} strokeOpacity={0.7} strokeWidth={1.6} strokeDasharray="3 3" fill="none" />
      {figure(76, 112, 0.9)}
    </>
  ),
  // Hakone : les pics, le lac Ashi et son torii planté dans l'eau, le poste de contrôle.
  hakone: () => (
    <>
      {range(150, 296, 106, [[228, 36]], 0.08, 56)}
      {range(6, 210, 112, [[36, 58], [54, 72], [84, 22], [106, 62], [128, 46], [162, 90]], 0.18)}
      <path d="M84 22 L92 50 L84 66 M36 58 L42 84" stroke={BG} strokeOpacity={0.5} fill="none" />
      {water(96, 292, 102, 156, 3)}
      <Sprite kind="torii" x={196} y={92} scale={0.45} snowy={false} />
      <path d="M216 134 v10 M240 134 v10 M210 136 h36" stroke={ACC} strokeOpacity={0.3} strokeWidth={1.6} />
      {reeds(262, 156)}
      {reeds(276, 152, 0.8)}
      {bank(0, 160, 122, 44, 0.12)}
      <Sprite kind="cedars" x={88} y={92} scale={0.5} snowy={false} />
      <Sprite kind="gate" x={6} y={104} scale={0.55} snowy={false} />
      {figure(120, 152, 0.9)}
    </>
  ),
  // Le gué de l'Ōi : le large lit du fleuve, et les porteurs qui passent les voyageurs.
  "oi-ford": (rail) => {
    const x = away(rail, 80, 290);
    return (
      <>
        {hills(-30, 220, 60, [[40, 28], [130, 34]], 0.07)}
        {hills(170, 420, 60, [[260, 30], [350, 24]], 0.07)}
        <Sprite kind="pines" x={10} y={-14} scale={0.6} snowy={false} />
        <Sprite kind="pines" x={300} y={-10} scale={0.55} snowy={false} />
        {water(0, 390, 54, 148, 4, "both")}
        <path d="M30 70 Q80 64 120 72 Q80 78 30 70 Z M250 132 Q300 124 350 134 Q300 140 250 132 Z" fill={tint(0.12)} />
        {/* Un palanquin sur une plate-forme, quatre porteurs dans l'eau. */}
        <rect x={x - 22} y={110} width={44} height={5} fill="currentColor" fillOpacity={0.5} />
        <path d={`M${x - 12} 110 V96 H${x + 12} V110 M${x - 14} 96 Q${x} 88 ${x + 14} 96`} stroke="currentColor" strokeOpacity={0.6} fill="currentColor" fillOpacity={0.15} />
        {[x - 18, x - 6, x + 6, x + 18].map((px) => figure(px, 130, 0.9, false))}
        {figure(x - 50, 70, 0.9, false)}
        {figure(x - 40, 74, 0.8)}
        {bank(-30, 420, 150, 34, 0.07)}
        <Sprite kind="teahouse" x={x > 195 ? 10 : 290} y={132} scale={0.55} snowy={false} />
      </>
    );
  },
  // Le lac Hamana : la traversée en bateau de Maisaka à Arai, les bancs de sable, les pins.
  hamana: (rail) => (
    <>
      {bank(-40, 430, 30, 20, 0.07)}
      <Sprite kind="gate" x={away(rail, 30, 250)} y={-12} scale={0.55} snowy={false} />
      {water(0, 390, 44, 158, 5, "both")}
      {pineIsle(away(rail, 70, 300), 70, 0.8)}
      {pineIsle(away(rail, 120, 250), 140, 0.7)}
      {sail(away(rail, 40, 340), 130, 0.6)}
      {bank(-40, 430, 160, 30, 0.07)}
      <Sprite kind="pines" x={away(rail, 20, 280)} y={124} scale={0.55} snowy={false} />
    </>
  ),
  // Les sept ri en mer : du torii d'Atsuta à Miya jusqu'au château de Kuwana.
  "miya-ferry": (rail) => (
    <>
      {bank(-40, 430, 26, 18, 0.07)}
      <Sprite kind="torii" x={away(rail, 20, 290)} y={-14} scale={0.5} snowy={false} />
      {water(0, 390, 36, 166, 6, "both")}
      {sail(away(rail, 60, 300), 70, 0.8)}
      {sail(away(rail, 110, 250), 140, 0.7)}
      {sail(away(rail, 30, 350), 120, 0.5)}
      {bank(-40, 430, 168, 28, 0.07)}
      <Sprite kind="castle" x={away(rail, 30, 260)} y={136} scale={0.6} snowy={false} />
    </>
  ),
  // Kyōto : le pont de Sanjō sur la Kamo, les collines de Higashiyama et la pagode de Yasaka.
  kyoto: () => (
    <>
      {hills(4, 296, 112, [[40, 56], [100, 64], [168, 30], [232, 52], [274, 46]], 0.1)}
      {bank(8, 292, 92, 40, 0.06)}
      <Sprite kind="pagoda" x={150} y={14} scale={1} snowy={false} />
      <Sprite kind="temple" x={40} y={50} scale={0.6} snowy={false} />
      <Sprite kind="roofs" x={200} y={66} scale={0.7} snowy={false} />
      {water(6, 294, 144, 192, 2)}
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
        <path d="M-10 80 V42 Q30 22 70 34 Q110 16 150 30 Q200 12 250 28 Q300 14 340 30 Q370 20 400 34 V80 Q300 70 220 78 T-10 74 Z" fill={tint(0.2)} />
        <path d="M-10 122 Q80 130 150 124 T400 126 V170 Q340 186 280 176 Q220 190 160 178 Q100 192 40 180 Q10 186 -10 178 Z" fill={tint(0.2)} />
        {/* Les parois de la gorge, à pic : strates de roche. */}
        <path d="M0 64 Q60 58 120 66 T240 62 T390 68 M0 52 Q80 46 160 54 T390 50 M0 138 Q70 144 150 136 T390 140 M0 152 Q90 158 190 150 T390 154" stroke="currentColor" strokeOpacity={0.16} fill="none" />
        <path d="M30 30 L44 64 M120 22 L112 66 M290 26 L304 64 M60 178 L74 136 M300 176 L286 134" stroke="currentColor" strokeOpacity={0.2} />
        <Sprite kind="pines" x={away(rail, 10, 290)} y={-28} scale={0.6} snowy={false} />
        <Sprite kind="cedars" x={away(rail, 30, 270)} y={124} scale={0.55} snowy={false} />
        {water(0, 390, 80, 120, 2, "both")}
        {/* Le pont-singe : sans pile, il tient par des consoles de poutres empilées qui avancent
            chacune un peu plus loin au-dessus du vide, depuis chaque rive. */}
        <g fill="currentColor">
          {[0, 1, 2, 3].map((k) => (
            <g key={k} fillOpacity={0.1 + k * 0.05} stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.8}>
              <rect x={x - 22 + k * 1.5} y={58} width={44 - k * 3} height={20 + k * 7} rx={1} />
              <rect x={x - 22 + k * 1.5} y={142 - 20 - k * 7} width={44 - k * 3} height={20 + k * 7} rx={1} />
            </g>
          ))}
        </g>
        <path d={`M${x - 22} 58 V78 M${x + 22} 58 V78 M${x - 22} 122 V142 M${x + 22} 122 V142`} stroke="currentColor" strokeOpacity={0.4} />
      </>
    );
  },
  // Le bassin de Kai : les vignes, la plaine, le Fuji par-dessus les monts.
  kai: () => (
    <>
      {range(90, 270, 90, [[180, 12]], 0.1, 40)}
      {range(4, 296, 112, [[40, 58], [80, 76], [118, 52], [160, 84], [206, 60], [248, 80], [276, 64]], 0.16)}
      {bank(6, 294, 104, 40, 0.06)}
      <Sprite kind="vines" x={0} y={104} scale={0.8} snowy={false} />
      <Sprite kind="vines" x={100} y={108} scale={0.8} snowy={false} />
      <Sprite kind="vines" x={200} y={104} scale={0.8} snowy={false} />
      {figure(150, 184, 0.9)}
    </>
  ),
  // Le lac Suwa, le château de Takashima sur sa rive, les monts autour.
  suwa: () => (
    <>
      {range(6, 294, 112, [[40, 52], [90, 66], [140, 26], [190, 58], [238, 32], [272, 60]], 0.12)}
      {water(10, 290, 104, 154, 3)}
      {bank(0, 112, 136, 26, 0.12)}
      <Sprite kind="castle" x={8} y={98} scale={0.6} snowy={false} />
      {sail(200, 130, 0.6)}
      {bank(150, 296, 160, 26, 0.08)}
      <Sprite kind="pines" x={196} y={134} scale={0.5} snowy={false} />
    </>
  ),
  // Le col d'Usui et l'Asama qui fume, au-dessus des cèdres.
  "usui-asama": () => (
    <>
      <Sprite kind="volcano" x={60} y={-10} scale={1.6} snowy={false} />
      <path d="M4 176 Q30 110 90 120 Q140 92 190 124 Q240 98 296 176 Q150 196 4 176 Z" fill={mist(0.14)} />
      <Sprite kind="cedars" x={10} y={100} scale={0.7} snowy={false} />
      <Sprite kind="cedars" x={196} y={104} scale={0.7} snowy={false} />
      <Sprite kind="gate" x={110} y={116} scale={0.5} snowy={false} />
      {figure(160, 178, 0.9)}
    </>
  ),
  // Le col de Magome : Tsumago et Magome, maisons en gradins sur la pente, la forêt du Kiso.
  kiso: () => (
    <>
      {range(4, 296, 96, [[50, 30], [100, 52], [160, 14], [220, 46], [270, 24]], 0.1)}
      <Sprite kind="cedars" x={0} y={34} scale={0.8} snowy={false} />
      <Sprite kind="cedars" x={210} y={30} scale={0.8} snowy={false} />
      <path d="M10 196 Q120 150 170 110 Q210 84 290 74 Q298 120 270 160 Q200 200 10 196 Z" fill={mist(0.1)} />
      <path d="M40 194 Q120 150 160 120 Q190 98 260 82" stroke={BG} strokeOpacity={0.7} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Sprite kind="town" x={150} y={66} scale={0.6} snowy={false} />
      <Sprite kind="town" x={90} y={104} scale={0.6} snowy={false} />
      <Sprite kind="town" x={30} y={140} scale={0.6} snowy={false} />
      {figure(200, 140, 0.8)}
    </>
  ),
  // Le lac Biwa : le mont Hiei au loin, les voiles d'Ōmi, et l'Ukimidō, le pavillon flottant
  // de Katata, posé sur ses pilotis au bout de sa passerelle.
  biwa: () => (
    <>
      {range(130, 296, 88, [[222, 34], [250, 44]], 0.1)}
      {hills(4, 170, 88, [[60, 52], [110, 60]], 0.07)}
      {water(4, 296, 82, 194, 4)}
      {sail(170, 124, 0.6)}
      {sail(236, 104, 0.45)}
      {bank(-10, 80, 180, 18, 0.14)}
      <g stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.4}>
        <path d="M20 190 L44 164 M28 192 L52 164" />
        <path d="M48 164 V176 M60 164 V178 M72 164 V178 M84 164 V176" />
      </g>
      <path d="M20 188 L44 162 H52 L28 192 Z" fill="currentColor" fillOpacity={0.3} />
      <Sprite kind="temple" x={34} y={112} scale={0.55} snowy={false} />
      <path d="M38 162 H100" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.6} />
      <path d="M50 182 h40 M58 188 h26" stroke={W} strokeOpacity={0.4} />
    </>
  ),
  // Fukagawa : l'ermitage du bananier, la Sumida, la barque du départ de Bashō.
  fukagawa: () => (
    <>
      {bank(-30, 320, 84, 50, 0.07)}
      <path d="M90 90 L120 64 H170 L196 90 Z" fill="currentColor" fillOpacity={0.3} />
      <rect x={104} y={90} width={80} height={30} fill={tint(0.1)} stroke="currentColor" strokeOpacity={0.4} />
      {/* Le bananier (bashō) qui donna son nom au poète. */}
      <g fill={tint(0.26)} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1}>
        <path d="M226 122 Q224 100 228 82 L234 82 Q236 100 234 122 Z" fill={tint(0.36)} />
        <path d="M230 84 Q206 76 194 52 Q190 42 200 44 Q216 56 230 84 Z" />
        <path d="M231 82 Q236 52 252 32 Q260 26 262 34 Q252 60 231 82 Z" />
        <path d="M232 90 Q258 84 278 66 Q286 62 284 72 Q262 94 232 90 Z" />
        <path d="M229 92 Q206 96 190 88 Q184 82 192 80 Q210 84 229 92 Z" />
      </g>
      <path d="M200 50 L212 62 M206 46 L216 60 M254 38 L246 56 M276 70 L260 80" stroke={BG} strokeWidth={1.2} />
      {water(0, 390, 130, 192, 3, "both")}
      {punt(150, 160)}
      {figure(176, 160, 0.9)}
      {figure(196, 160, 0.9, false)}
      {archBridge(290, 420, 112, 14)}
    </>
  ),
  // Nikkō : le Tōshō-gū et sa pagode dans les cèdres, le pont sacré Shinkyō.
  nikko: () => (
    <>
      {hills(4, 296, 136, [[60, 34], [150, 22], [240, 36]], 0.07)}
      <Sprite kind="cedars" x={0} y={-10} scale={1.1} snowy={false} />
      <Sprite kind="cedars" x={170} y={-6} scale={1.1} snowy={false} />
      <Sprite kind="pagoda" x={80} y={0} scale={0.9} snowy={false} />
      <Sprite kind="shrine" x={160} y={60} scale={0.7} snowy={false} />
      {water(6, 294, 140, 194, 2)}
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
      {water(4, 296, 36, 196, 6)}
      {pineIsle(60, 80, 1)}
      {pineIsle(170, 64, 0.8)}
      {pineIsle(250, 110, 1.1)}
      {pineIsle(110, 150, 0.9)}
      {pineIsle(220, 180, 0.7)}
      {sail(56, 180, 0.5)}
    </>
  ),
  // Hiraizumi : le pavillon d'or du Chūson-ji sur sa colline, la Kitakami, les herbes d'été.
  hiraizumi: () => (
    <>
      {hills(4, 296, 142, [[80, 46], [160, 58], [240, 92]], 0.12)}
      <Sprite kind="cedars" x={20} y={26} scale={0.7} snowy={false} />
      <Sprite kind="cedars" x={190} y={34} scale={0.7} snowy={false} />
      <Sprite kind="temple" x={100} y={26} scale={0.8} snowy={false} />
      {water(6, 294, 138, 172, 2)}
      {[10, 30, 120, 140, 236, 256].map((x, i) => reeds(x, 194 - (i % 2) * 4))}
    </>
  ),
  // Yamadera : les pavillons accrochés à la falaise, l'escalier, les cèdres.
  yamadera: () => (
    <>
      <path d="M30 196 Q48 140 66 112 L92 62 Q110 30 134 22 L186 10 Q214 26 232 50 L262 104 Q282 150 292 196 Q160 206 30 196 Z" fill={mist(0.16)} />
      <path d="M92 62 L110 110 M186 10 L178 70 M232 50 L220 120" stroke={BG} strokeOpacity={0.5} fill="none" />
      <Sprite kind="temple" x={150} y={-2} scale={0.5} snowy={false} />
      <Sprite kind="shrine" x={80} y={50} scale={0.45} snowy={false} />
      <Sprite kind="temple" x={200} y={70} scale={0.45} snowy={false} />
      <path d="M120 196 Q130 160 150 140 Q170 120 180 40" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.4} strokeDasharray="3 3" fill="none" />
      <Sprite kind="cedars" x={0} y={124} scale={0.65} snowy={false} />
      <Sprite kind="cedars" x={220} y={128} scale={0.65} snowy={false} />
    </>
  ),
  // Kisakata : la lagune aux îles, sous le mont Chōkai enneigé.
  kisakata: () => (
    <>
      {range(50, 296, 100, [[176, 16]], 0.12, 44)}
      {water(4, 296, 94, 196, 4)}
      {pineIsle(60, 130, 0.8)}
      {pineIsle(150, 150, 1)}
      {pineIsle(250, 176, 0.8)}
      {sail(230, 126, 0.5)}
    </>
  ),
  // Ōgaki : le château, le canal, et la barque où Bashō repart pour Ise.
  ogaki: () => (
    <>
      {bank(0, 130, 70, 30, 0.07)}
      <Sprite kind="pines" x={20} y={26} scale={0.6} snowy={false} />
      {bank(110, 296, 78, 40, 0.1)}
      <Sprite kind="castle" x={150} y={6} scale={1} snowy={false} />
      <Sprite kind="sakura" x={226} y={42} scale={0.6} snowy={false} />
      {water(4, 296, 112, 194, 3)}
      {punt(90, 160)}
      {figure(120, 160, 0.9)}
    </>
  ),
  // Le détroit de Naruto et ses tourbillons, entre les caps d'Awaji et de Shikoku.
  naruto: () => (
    <>
      {water(0, 390, 52, 196, 4, "both")}
      <path d="M-10 26 Q40 14 90 28 Q132 42 122 62 Q84 82 30 74 Q4 72 -10 80 Z" fill={tint(0.2)} />
      <path d="M400 26 Q350 14 300 28 Q258 42 268 62 Q306 82 360 74 Q386 72 400 80 Z" fill={tint(0.2)} />
      <Sprite kind="pines" x={4} y={-24} scale={0.6} snowy={false} />
      <Sprite kind="pines" x={296} y={-24} scale={0.6} snowy={false} />
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
  // Le cap Muroto : la falaise couverte de forêt où veille le Hotsumisaki-ji, la grotte où
  // médita Kūkai, les rochers noirs où la vague se brise en écume.
  muroto: () => (
    <>
      {water(100, 296, 60, 194, 5)}
      <path d="M6 196 Q10 120 20 74 Q30 34 70 26 Q130 18 170 42 Q190 70 160 100 Q130 130 140 196 Q70 204 6 196 Z" fill={mist(0.2)} />
      <Sprite kind="cedars" x={14} y={-12} scale={0.55} snowy={false} />
      <Sprite kind="temple" x={76} y={-8} scale={0.6} snowy={false} />
      <path d="M58 180 V156 Q72 134 88 156 V180 Z" fill="currentColor" fillOpacity={0.45} />
      <path d="M50 180 H96" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} />
      <g fill="currentColor" fillOpacity={0.5}>
        <path d="M170 150 L178 132 L188 128 L196 138 L204 150 Z" />
        <path d="M226 178 L232 162 L242 158 L252 166 L258 178 Z" />
        <path d="M262 128 L268 118 L278 120 L282 128 Z" />
      </g>
      <g stroke={SNOW} strokeWidth={2} fill="none" strokeLinecap="round">
        <path d="M162 150 q8 -16 18 -8 q4 -8 10 -2 M216 178 q8 -14 16 -6" />
        <path d="M206 150 q6 -6 12 0 M260 178 q5 -6 10 0" />
      </g>
      {figure(112, 192, 0.9)}
    </>
  ),
  // Les gorges d'Iya et leur pont de lianes.
  iya: () => (
    <>
      {water(84, 216, 150, 194, 2)}
      <path d="M4 192 Q8 100 14 44 Q40 26 80 36 L96 62 Q104 120 114 192 Q60 200 4 192 Z" fill={mist(0.2)} />
      <path d="M296 192 Q292 100 286 44 Q260 26 220 36 L204 62 Q196 120 186 192 Q240 200 296 192 Z" fill={mist(0.2)} />
      <Sprite kind="cedars" x={4} y={-8} scale={0.6} snowy={false} />
      <Sprite kind="cedars" x={224} y={-8} scale={0.6} snowy={false} />
      <g stroke="currentColor" strokeOpacity={0.6} fill="none" strokeLinecap="round">
        <path d="M94 70 Q150 120 206 70" strokeWidth={2} />
        <path d="M94 50 Q150 100 206 50" strokeWidth={1.4} />
        <path d="M108 61 v12 M122 70 v14 M136 78 v14 M150 80 v15 M164 78 v14 M178 70 v14 M192 61 v12" strokeWidth={1} />
      </g>
      {figure(150, 92, 0.8)}
    </>
  ),
  // Zentsū-ji, lieu de naissance de Kūkai : la grande pagode à cinq toits entre les camphriers
  // géants de l'enceinte, le pavillon devant.
  zentsuji: () => (
    <>
      {bank(-10, 310, 188, 12, 0.1)}
      {bigTree(56, 196, 1.15)}
      {bigTree(256, 196, 1)}
      <Sprite kind="pagoda" x={92} y={-6} scale={1.45} snowy={false} />
      <Sprite kind="temple" x={150} y={128} scale={0.62} snowy={false} />
      {figure(118, 196, 0.9)}
    </>
  ),
  // Ōkubo-ji, le dernier des 88 temples : le hall dans les cèdres de la montagne, l'escalier de
  // pierre, et le râtelier où les pèlerins laissent leur bâton (kongō-zue).
  okuboji: () => (
    <>
      {range(4, 296, 116, [[60, 40], [120, 70], [180, 26], [240, 62], [276, 42]], 0.1)}
      <Sprite kind="cedars" x={0} y={58} scale={0.8} snowy={false} />
      <Sprite kind="cedars" x={204} y={54} scale={0.8} snowy={false} />
      <Sprite kind="temple" x={88} y={60} scale={0.95} snowy={false} />
      <path d="M128 132 h44 M124 140 h52 M120 148 h60 M116 156 h68" stroke="currentColor" strokeOpacity={0.3} strokeWidth={2} />
      <path d="M112 162 H188 V170 H112 Z" fill={tint(0.08)} />
      {/* Le râtelier : deux montants, une traverse, les bâtons coiffés de leur pointe en stūpa. */}
      <g>
        <path d="M206 198 V160 M262 198 V160 M202 168 H266" stroke="currentColor" strokeOpacity={0.55} strokeWidth={2} />
        {[212, 218, 224, 230, 236, 242, 248, 254].map((x, i) => (
          <g key={x}>
            <path d={`M${x + (i % 2 ? 1 : -1)} 198 L${x} 150`} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1.8} />
            <path d={`M${x - 2} 150 h4 l-2 -5 Z`} fill="currentColor" fillOpacity={0.55} />
            <rect x={x - 2.2} y={153} width={4.4} height={7} fill={SNOW} stroke="currentColor" strokeOpacity={0.35} strokeWidth={0.6} />
          </g>
        ))}
      </g>
      {figure(182, 196, 0.95)}
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
        <MistDefs />
        {ART[kind](rail)}
      </svg>
    </g>
  );
}
