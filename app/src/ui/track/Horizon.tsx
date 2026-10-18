import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  biomeAt,
  biomeTrack,
  DRIFT_PATHS,
  driftItems,
  markRaised,
  SKY_MAX,
  skyHeight,
  skyMarks,
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
/** Taille d'un repère (boîte 120 × 80 du catalogue), et ce que la crête proche en cache. */
const MARK_W = 92;
const MARK_H = (MARK_W * 80) / 120;
const NEAR_RIDGE = 22;

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
function Drift({ items, bottom, fill }: { items: DriftItem[]; bottom: number; fill: string }) {
  return (
    <>
      {items.map((it) => (
        <svg
          key={it.key}
          viewBox="0 0 40 30"
          className="absolute block"
          style={{ left: it.x - 20 * it.scale, bottom, width: 40 * it.scale, height: 30 * it.scale }}
        >
          <path d={DRIFT_PATHS[it.kind]} fill={fill} />
        </svg>
      ))}
    </>
  );
}

/**
 * La bande de ciel (SPEC §5c.6b), collée sous le bandeau de leçon : le panorama du départ qui se
 * replie, les repères des villes qui se lèvent derrière la crête tant que leur ville est sur la
 * voie visible, et le décor qui défile en deux plans. La voie passe dessous, derrière la crête.
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
  const W = layout.width;
  const at = (y: number) => biomeAt(biomes, y);
  const mid = driftItems("mid", pos, W, visible / 3, at);
  const near = driftItems("near", pos, W, visible / 3, at);
  const titleOpacity = Math.max(0, 1 - Math.max(0, view.u) / 120);

  return (
    <div data-sky={sky.time} className="sticky z-10" style={{ top, height: skyH, marginBottom: -skyH }}>
      <Sky sky={sky} height={skyH}>
        {title && titleOpacity > 0 && (
          <div className="absolute inset-x-0 top-8 flex flex-col items-center gap-1.5 text-text" style={{ opacity: titleOpacity }}>
            <span className="font-jp text-3xl tracking-widest">{title.kanji}</span>
            <span className="text-xs uppercase tracking-wide text-muted">{title.tagline}</span>
          </div>
        )}
        <svg width={W} height={40} viewBox={`0 0 ${W} 40`} preserveAspectRatio="none" className="absolute bottom-0 left-0 block">
          <path
            d={`M0 40 L0 22 L${W * 0.12} 10 L${W * 0.24} 20 L${W * 0.38} 4 L${W * 0.52} 18 L${W * 0.67} 8 L${W * 0.82} 20 L${W} 10 L${W} 40 Z`}
            fill="var(--sky-ridge)"
          />
        </svg>
        <Drift items={mid} bottom={16} fill="var(--sky-mid)" />
        {marks.filter((m) => m.y > pos - 1500 && m.y < pos + visible + 1500).map((m) => {
          const up = markRaised(m, pos, pos + visible);
          return (
            <span
              key={m.id}
              className={`sky-mark absolute ${up ? "sky-mark-up" : ""}`}
              style={{ left: m.x * W - MARK_W / 2, bottom: NEAR_RIDGE - 8, width: MARK_W, height: MARK_H }}
            >
              <svg width={MARK_W} height={MARK_H} viewBox="0 0 120 80" className="block text-text" style={{ opacity: 0.9 }}>
                <Sprite kind={m.kind} x={0} y={0} scale={1} snowy={season === "winter"} />
              </svg>
              <span className="sky-mark-name absolute left-1/2 whitespace-nowrap text-xs text-muted" style={{ bottom: MARK_H + 6 }}>
                {m.name}
              </span>
            </span>
          );
        })}
        <svg width={W} height={NEAR_RIDGE} viewBox={`0 0 ${W} ${NEAR_RIDGE}`} preserveAspectRatio="none" className="absolute bottom-0 left-0 block">
          <path
            d={`M0 ${NEAR_RIDGE} L0 12 Q${W * 0.12} 2 ${W * 0.25} 10 T${W * 0.5} 6 T${W * 0.75} 12 T${W} 4 L${W} ${NEAR_RIDGE} Z`}
            fill="var(--bg)"
          />
        </svg>
        <Drift items={near} bottom={8} fill="var(--bg)" />
      </Sky>
    </div>
  );
}
