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
  skyHeight,
  skyMarks,
  WINDOW_INSET,
  WINDOW_TOP,
  type DriftItem,
} from "../../lib/horizon";
import type { RouteScenery, Season } from "../../lib/scenery";
import type { TrackLayout } from "../../lib/track";
import { Sky, useSky } from "./Sky";
import { Sprite } from "./sprites";

interface Props {
  layout: TrackLayout;
  sceneries: RouteScenery[];
  season: Season;
  /** Hauteur du bandeau collant au-dessus. */
  top: number;
  /** Le conteneur de la voie (juste sous la place gardée pour le panorama déplié). */
  track: RefObject<HTMLDivElement | null>;
  /** Le nom de la route du départ, en grand dans le panorama. */
  title?: { kanji: string; tagline: string };
}

/** Hauteur de la barre d'onglets, sous la voie visible. */
const TABBAR = 64;
/** Taille d'un repère (boîte 120 × 80 du catalogue : son pied est vers y = 72). */
const MARK_W = 92;
const MARK_H = (MARK_W * 80) / 120;

interface View {
  /** Défilement de la bande au-delà de sa place collée. */
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
 * dont le nom paraît autour de leur place. Sous l'horizon, le sol étage les
 * plans : la crête au fond, puis le plan moyen, les repères, le plan proche en bas. La bande se
 * regarde par la fenêtre du train : une vitre encadrée, en retrait, qui la sépare de la voie.
 */
export function Horizon({ layout, sceneries, season, top, track, title }: Props) {
  const sky = useSky(season);
  const [view, setView] = useState<View>({ u: 0, skyH: SKY_MAX, pos: 0, visible: 600 });

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const natural = r.top - SKY_MAX;
      const u = top - natural;
      const skyH = skyHeight(u);
      const bottom = Math.max(top, natural) + skyH;
      const next = { u, skyH, pos: bottom - r.top, visible: Math.max(120, window.innerHeight - bottom - TABBAR) };
      setView((v) => (sameView(v, next) ? v : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [track, top, layout]);

  const marks = useMemo(() => skyMarks(layout, sceneries), [layout, sceneries]);
  const biomes = useMemo(() => biomeTrack(layout, sceneries), [layout, sceneries]);
  const { skyH, pos, visible } = view;
  // La vitre, en retrait du bandeau, du bord de l'écran et du bas de la bande.
  const W = layout.width - 2 * WINDOW_INSET;
  const glassH = skyH - WINDOW_TOP - WINDOW_INSET;
  const at = (y: number) => biomeAt(biomes, y);
  const mid = driftItems("mid", pos, W, visible / 3, at);
  const ground = groundDepth(skyH);
  // Les plans rapetissent quand le sol s'aplatit (bande repliée).
  const size = 0.7 + (0.3 * (ground - 50)) / 62;
  const marked = marks.map((m) => markX(m, pos, visible, W)).filter((x) => x > -MARK_W && x < W + MARK_W);
  // Devant un repère, le premier plan s'écarte : rien ne le cache.
  const near = driftItems("near", pos, W, visible / 3, at).filter((it) => marked.every((x) => Math.abs(it.x - x) > MARK_W * 0.45));
  const titleOpacity = Math.max(0, 1 - Math.max(0, view.u) / 120);

  return (
    <div data-sky={sky.time} className="horizon-frame sticky z-10 bg-bg" style={{ top, height: skyH, marginBottom: -skyH, padding: `${WINDOW_TOP}px ${WINDOW_INSET}px ${WINDOW_INSET}px` }}>
      <div className="horizon-window relative overflow-hidden rounded-md" style={{ height: glassH }}>
      <Sky sky={sky} height={glassH} ground={ground}>
        {title && titleOpacity > 0 && (
          <div className="absolute inset-x-0 top-8 flex flex-col items-center gap-1.5 text-text" style={{ opacity: titleOpacity }}>
            <span className="font-jp text-3xl tracking-widest">{title.kanji}</span>
            <span className="text-xs uppercase tracking-wide text-muted">{title.tagline}</span>
          </div>
        )}
        <svg width={W} height={40} viewBox={`0 0 ${W} 40`} className="absolute left-0 block" style={{ bottom: ground * PLANE_AT.ridge }}>
          <path d={ridgePath(pos, W)} fill="var(--sky-ridge)" />
        </svg>
        {/* Le sol, de l'horizon au bas de la bande : il se fond dans le fond de la voie. */}
        <div className="horizon-ground absolute inset-x-0 bottom-0" style={{ height: ground }} />
        <Drift items={mid} bottom={ground * PLANE_AT.mid} fill="var(--sky-mid)" size={size} />
        {marks.map((m) => {
          const x = markX(m, pos, visible, W);
          if (x < -MARK_W || x > W + MARK_W) return null;
          const up = markRaised(m, pos, pos + visible);
          return (
            <span
              key={m.id}
              className={`absolute ${up ? "sky-mark-up" : ""}`}
              style={{ left: x - MARK_W / 2, bottom: ground * PLANE_AT.marks - MARK_H / 10, width: MARK_W, height: MARK_H }}
            >
              <svg width={MARK_W} height={MARK_H} viewBox="0 0 120 80" className="block text-text">
                <Sprite kind={m.kind} x={0} y={0} scale={1} snowy={season === "winter"} />
              </svg>
              <span className="sky-mark-name absolute left-1/2 whitespace-nowrap text-xs text-muted" style={{ bottom: MARK_H + 6 }}>
                {m.name}
              </span>
            </span>
          );
        })}
        <Drift items={near} bottom={ground * PLANE_AT.near + NEAR_GAP} fill="var(--sky-near)" size={size} />
      </Sky>
      </div>
    </div>
  );
}
