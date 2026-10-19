import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  biomeAt,
  biomeTrack,
  DRIFT_PATHS,
  driftItems,
  groundDepth,
  markRaised,
  markX,
  NEAR_GAP,
  PLANE_AT,
  ridgePath,
  SKY_MAX,
  SKY_MIN,
  skyHeight,
  signX,
  skyMarks,
  SKY_MARGIN,
  stations,
  WINDOW_BLIND,
  WINDOW_INSET,
  WINDOW_TOP,
  type DriftItem,
  type SkyMark,
} from "../../lib/horizon";
import type { RouteScenery, Season } from "../../lib/scenery";
import type { TrackLayout } from "../../lib/track";
import { Sky, useSky } from "./Sky";
import { Sprite } from "./sprites";
import { Glass, Poles, StationSign } from "./Train";

interface Props {
  layout: TrackLayout;
  sceneries: RouteScenery[];
  season: Season;
  /** La zone où défile la voie, juste sous la fenêtre repliée ; elle commence par la place du
      panorama déplié (`SKY_MAX − SKY_MIN`), que la fenêtre couvre tant qu'elle se replie. */
  scroller: RefObject<HTMLDivElement | null>;
  /** Le conteneur de la voie, dans cette zone. */
  track: RefObject<HTMLDivElement | null>;
  /** Le nom de la route du départ, en grand dans le panorama. */
  title?: { kanji: string; tagline: string };
}

/** Taille d'un repère (boîte 120 × 80 du catalogue : son pied est vers y = 72). */
const MARK_W = 92;
const MARK_H = (MARK_W * 80) / 120;
/** Les repères du fond (les monts) sont plus grands : ils dominent le paysage ; comme les plans,
    ils rapetissent quand la bande se replie. */
const FAR_MARK_SCALE = 1.4;
/** Ce que le paysage déborde sous la vitre, pour le roulis. */
const ROLL = 2;

interface View {
  /** Défilement de la voie depuis son ouverture du panorama. */
  u: number;
  skyH: number;
  /** Ordonnée de voie du bas du ciel, et hauteur de voie visible dessous. */
  pos: number;
  visible: number;
}

function sameView(a: View, b: View): boolean {
  return Math.abs(a.u - b.u) < 0.5 && Math.abs(a.pos - b.pos) < 0.5 && Math.abs(a.visible - b.visible) < 1;
}

/** Un plan du décor qui défile : des silhouettes posées sur l'horizon. */
function Drift({ items, bottom, fill, size = 1 }: { items: DriftItem[]; bottom: number; fill: string; size?: number }) {
  return (
    <>
      {items.map((it) => (
        <svg
          key={it.key}
          viewBox="0 0 40 30"
          className="absolute block"
          style={{ left: it.x - 20 * it.scale * size, bottom, width: 40 * it.scale * size, height: 30 * it.scale * size }}
        >
          <path d={DRIFT_PATHS[it.kind]} fill={fill} />
        </svg>
      ))}
    </>
  );
}

/**
 * La bande de ciel (SPEC §5c.6b), collée sous le bandeau de leçon : le panorama du départ qui se
 * replie, et le décor qui défile en deux plans ; entre les deux glissent les repères des villes,
 * dont le nom paraît autour de leur place. Sous l'horizon, le sol étage les plans : la crête au
 * fond, le plan lointain (monts et collines, et les repères qui sont des monts), le plan moyen,
 * les autres repères, le plan proche en bas. La bande se regarde par la fenêtre
 * du train, une vitre encadrée en retrait ; la voie défile dans sa propre zone, sous la fenêtre.
 */
export function Horizon({ layout, sceneries, season, scroller, track, title }: Props) {
  const sky = useSky(season);
  const [view, setView] = useState<View>({ u: 0, skyH: SKY_MAX, pos: 0, visible: 600 });

  useEffect(() => {
    const zone = scroller.current;
    if (!zone) return;
    let frame = 0;
    // Tout se mesure dans la zone de la voie : le haut de la voie, le bas de la fenêtre et la
    // voie visible, du bas de la fenêtre au bas de la zone.
    const update = () => {
      frame = 0;
      const el = track.current;
      if (!el) return;
      const trackTop = el.getBoundingClientRect().top - zone.getBoundingClientRect().top;
      const u = SKY_MAX - SKY_MIN - trackTop;
      const skyH = skyHeight(u);
      const bottom = skyH - SKY_MIN;
      const next = { u, skyH, pos: bottom - trackTop, visible: Math.max(120, zone.clientHeight - bottom) };
      setView((v) => (sameView(v, next) ? v : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    zone.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(zone);
    return () => {
      zone.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scroller, track, layout]);

  const marks = useMemo(() => skyMarks(layout, sceneries), [layout, sceneries]);
  const biomes = useMemo(() => biomeTrack(layout, sceneries), [layout, sceneries]);
  const gares = useMemo(() => stations(layout), [layout]);
  const { skyH, pos, visible } = view;
  // La vitre, en retrait du bandeau, du bord de l'écran et du bas de la bande.
  const W = layout.width - 2 * WINDOW_INSET;
  const glassH = skyH - WINDOW_TOP - WINDOW_INSET;
  const at = (y: number) => biomeAt(biomes, y);
  const far = driftItems("far", pos, W, visible / 3, at);
  const mid = driftItems("mid", pos, W, visible / 3, at);
  const ground = groundDepth(skyH);
  // Les plans rapetissent quand le sol s'aplatit (bande repliée).
  const size = 0.7 + (0.3 * (ground - 50)) / 62;
  const marked = marks.filter((m) => m.depth !== "far").map((m) => markX(m, pos, visible, W)).filter((x) => x > -MARK_W && x < W + MARK_W);
  // Devant un repère, le premier plan s'écarte : rien ne le cache.
  const near = driftItems("near", pos, W, visible / 3, at).filter((it) => marked.every((x) => Math.abs(it.x - x) > MARK_W * 0.45));
  // Un repère sur son plan : les monts tout au fond, derrière le plan lointain ; le reste devant le
  // plan moyen.
  const renderMark = (m: SkyMark, base: number) => {
    const x = markX(m, pos, visible, W);
    if (x < -MARK_W || x > W + MARK_W) return null;
    const up = markRaised(m, pos, pos + visible);
    const k = m.depth === "far" ? FAR_MARK_SCALE * size : 1;
    const w = MARK_W * k;
    const h = MARK_H * k;
    const bottom = base - h / 10;
    return (
      <span
        key={m.id}
        className={`absolute ${up ? "sky-mark-up" : ""}`}
        style={{ left: x - w / 2, bottom, width: w, height: h }}
      >
        <svg width={w} height={h} viewBox="0 0 120 80" className="block text-text">
          <Sprite kind={m.kind} x={0} y={0} scale={1} snowy={season === "winter"} />
        </svg>
        {/* Le nom au-dessus du dessin, sans passer sous le store. */}
        <span className="sky-mark-name absolute left-1/2 whitespace-nowrap text-xs text-muted" style={{ bottom: Math.min(h + 6, glassH - WINDOW_BLIND - bottom - 20) }}>
          {m.name}
        </span>
      </span>
    );
  };
  // Le panneau de quai de la gare qui passe, s'il est dans la vitre.
  const sign = gares.map((st) => ({ st, x: signX(st, pos, visible, W) })).find(({ x }) => Math.abs(x - W / 2) < W / 2 + 80);
  const titleOpacity = Math.max(0, 1 - Math.max(0, view.u) / 120);

  return (
    // La place de la fenêtre repliée, au-dessus de la zone de la voie ; dépliée, la fenêtre couvre
    // le haut de la zone, où la voie n'a pas encore commencé. La bande n'a aucun bouton : la molette
    // y fait défiler la voie, et les gestes passent à la zone dessous.
    <div className="relative z-10 shrink-0" style={{ height: SKY_MIN }} onWheel={(e) => scroller.current?.scrollBy({ top: e.deltaY })}>
      <div data-sky={sky.time} className="horizon-frame pointer-events-none absolute inset-x-0 top-0 bg-bg" style={{ height: skyH, padding: `${WINDOW_TOP}px ${WINDOW_INSET}px ${WINDOW_INSET}px` }}>
        <div className="horizon-window relative overflow-hidden rounded-md" style={{ height: glassH, ["--sky-span" as string]: `${W + 2 * SKY_MARGIN}px` }}>
          {/* Le paysage roule avec le train ; il déborde un peu sous la vitre, pour que le roulis ne
              découvre jamais son bord. La vitre et l'intérieur, par-dessus, ne bougent pas. */}
          <div className="horizon-roll absolute inset-0">
            <Sky sky={sky} height={glassH + ROLL} ground={ground + ROLL} width={W} pos={pos}>
              {title && titleOpacity > 0 && (
                <div className="absolute inset-x-0 top-8 flex flex-col items-center gap-1.5 text-text" style={{ opacity: titleOpacity }}>
                  <span className="font-jp text-3xl tracking-widest">{title.kanji}</span>
                  <span className="text-xs uppercase tracking-wide text-muted">{title.tagline}</span>
                </div>
              )}
              <svg width={W} height={40} viewBox={`0 0 ${W} 40`} className="absolute left-0 block" style={{ bottom: ground * PLANE_AT.ridge }}>
                <path d={ridgePath(pos, W)} fill="var(--sky-ridge)" />
              </svg>
              {/* Le sol, de l'horizon au bas de la vitre. */}
              <div className="horizon-ground absolute inset-x-0 bottom-0" style={{ height: ground }} />
              {marks.filter((m) => m.depth === "far").map((m) => renderMark(m, ground * PLANE_AT.far))}
              <Drift items={far} bottom={ground * PLANE_AT.far} fill="var(--sky-far)" size={size} />
              <Drift items={mid} bottom={ground * PLANE_AT.mid} fill="var(--sky-mid)" size={size} />
              {marks.filter((m) => m.depth !== "far").map((m) => renderMark(m, ground * PLANE_AT.marks))}
              <Drift items={near} bottom={ground * PLANE_AT.near + NEAR_GAP + ROLL} fill="var(--sky-near)" size={size} />
              <Poles pos={pos} width={W} height={glassH + ROLL} />
              {/* Le panneau devant les poteaux : son nom reste lisible quand l'un passe. */}
              {sign && <StationSign station={sign.st} x={sign.x} />}
            </Sky>
          </div>
          <Glass rain={season === "rainy"} night={sky.time === "night"} />
        </div>
      </div>
    </div>
  );
}
