import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  BAND_MAX,
  GROUND,
  groundScene,
  sampleTracks,
  skyHeight,
  skyMarkPoses,
  skyMarks,
  fade,
  type GroundNode,
} from "../../lib/horizon";
import type { Decor as DecorData, RouteScenery, Season } from "../../lib/scenery";
import { TRAIN_LENGTH, type TrackLayout } from "../../lib/track";
import { Sky, useSky } from "./Sky";
import { Sprite } from "./sprites";
import { UniqueArt } from "./uniques";
import { cityGlyph, EXTRA_WORDS, STEP_WORDS } from "./words";

interface Props {
  layout: TrackLayout;
  decor?: DecorData;
  sceneries: RouteScenery[];
  season: Season;
  /** Hauteur du bandeau collant au-dessus. */
  top: number;
  /** Le conteneur de la voie (juste sous la place gardée pour la bande dépliée). */
  track: RefObject<HTMLDivElement | null>;
  trainColor: (level: number) => string;
  /** Le nom de la route du départ, en grand dans le panorama. */
  title?: { kanji: string; tagline: string };
}

/** Hauteur de la barre d'onglets, sous la voie visible. */
const TABBAR = 64;

interface View {
  /** Défilement de la bande au-delà de sa place collée. */
  u: number;
  skyH: number;
  /** Ordonnée de voie du raccord, et hauteur de voie visible dessous. */
  cB: number;
  visible: number;
}

function sameView(a: View, b: View): boolean {
  return Math.abs(a.u - b.u) < 0.5 && Math.abs(a.cB - b.cB) < 0.5 && Math.abs(a.visible - b.visible) < 1;
}

/** Le kanji d'un arrêt, et sa couleur debout sur le disque. */
function glyphOf(n: GroundNode["node"]): { text: string; color: string } {
  if (n.kind === "city") return { text: cityGlyph(n.city), color: "var(--accent-2)" };
  const w = n.kind === "step" ? STEP_WORDS[n.step] : EXTRA_WORDS[n.extra];
  return { text: w.icon, color: n.state === "done" ? "var(--on-accent)" : n.state === "cur" ? "var(--accent)" : "var(--text-muted)" };
}

function labelOf(n: GroundNode["node"]): { word: string; line: string } {
  if (n.kind === "city") return { word: n.city.kanji, line: n.city.romaji };
  const w = n.kind === "step" ? STEP_WORDS[n.step] : EXTRA_WORDS[n.extra];
  return { word: w.word, line: n.kind === "step" ? `${n.number} · ${w.fr}` : w.fr };
}

/** Le disque couché d'un arrêt, à son état. */
function Disc({ g }: { g: GroundNode }) {
  const n = g.node;
  const dim = n.kind !== "city" && n.dim ? 0.45 : 1;
  let fill = "var(--bg)";
  let stroke = "var(--hairline-strong)";
  let dash: string | undefined = "3 3";
  let sw = 1;
  if (n.kind === "city") {
    stroke = "var(--accent-2)";
    sw = n.passed ? 3 : 2;
    dash = n.passed ? undefined : "4 3";
    if (n.passed) fill = "var(--surface)";
  } else if (n.state === "done") {
    fill = "var(--accent)";
    stroke = "var(--accent)";
    dash = undefined;
  } else if (n.state === "cur") {
    stroke = "var(--accent)";
    sw = 2;
  }
  return (
    <ellipse
      cx={g.x}
      cy={g.y}
      rx={g.rx}
      ry={g.ry}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw * g.f}
      strokeDasharray={dash}
      opacity={dim}
    />
  );
}

/**
 * La bande d'horizon (SPEC §5c.6b), collée sous le bandeau de leçon : le ciel, ses repères qui
 * se lèvent quand leur ville approche, et dessous le sol qui fuit, où la voie passée sous la
 * bande est projetée sans couture. Tout suit le défilement, image par image.
 */
export function Horizon({ layout, decor, sceneries, season, top, track, trainColor, title }: Props) {
  const sky = useSky(season);
  const [view, setView] = useState<View>({ u: 0, skyH: skyHeight(0), cB: 0, visible: 600 });

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = track.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const natural = r.top - BAND_MAX;
      const u = top - natural;
      const skyH = skyHeight(u);
      const junction = Math.max(top, natural) + skyH + GROUND;
      const next = { u, skyH, cB: junction - r.top, visible: Math.max(120, window.innerHeight - junction - TABBAR) };
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

  const tracks = useMemo(() => sampleTracks(layout.paths), [layout.paths]);
  const marks = useMemo(() => skyMarks(layout, sceneries), [layout, sceneries]);
  const scene = useMemo(() => groundScene(layout, tracks, decor, view.cB, view.skyH), [layout, tracks, decor, view.cB, view.skyH]);
  const poses = skyMarkPoses(marks, view.cB, view.visible, view.skyH, layout.width);
  const { skyH } = view;
  const W = layout.width;
  const junction = skyH + GROUND;
  const titleOpacity = Math.max(0, 1 - Math.max(0, view.u) / 120);

  return (
    <div
      aria-hidden="true"
      data-sky={sky.time}
      className="pointer-events-none sticky z-10"
      style={{ top, height: BAND_MAX, marginBottom: -BAND_MAX }}
    >
      <Sky sky={sky} height={skyH}>
        {title && titleOpacity > 0 && (
          <div className="absolute inset-x-0 top-6 flex flex-col items-center gap-1.5 text-text" style={{ opacity: titleOpacity }}>
            <span className="font-jp text-3xl tracking-widest">{title.kanji}</span>
            <span className="text-xs uppercase tracking-wide text-muted">{title.tagline}</span>
          </div>
        )}
        <svg width={W} height={14} viewBox={`0 0 ${W} 14`} preserveAspectRatio="none" className="absolute bottom-0 left-0 block">
          <path
            d={`M0 14 L0 8 L${W * 0.1} 4 L${W * 0.22} 8 L${W * 0.31} 5 L${W * 0.44} 9 L${W * 0.59} 5 L${W * 0.69} 8 L${W * 0.82} 2 L${W * 0.92} 7 L${W} 5 L${W} 14 Z`}
            fill="var(--sky-ridge)"
          />
        </svg>
        <svg width={W} height={skyH} className="absolute left-0 top-0 block text-text">
          {poses.map((p) => {
            const s = p.w / 120;
            const h = 80 * s;
            return (
              <g key={p.mark.id} opacity={p.opacity * 0.75}>
                <Sprite kind={p.mark.kind} x={p.x - p.w / 2} y={skyH - h + 4 * s} scale={s} snowy={season === "winter"} />
                {p.label > 0 && (
                  <text x={p.x} y={skyH - h - 2} textAnchor="middle" fontSize={11} fill="var(--text-muted)" opacity={p.label}>
                    {p.mark.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </Sky>

      <svg width={W} height={BAND_MAX} className="absolute left-0 top-0 block text-text">
        <defs>
          <clipPath id="horizon-ground">
            <rect x={0} y={skyH} width={W} height={GROUND} />
          </clipPath>
          <linearGradient id="horizon-haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky-low)" stopOpacity={1} />
            <stop offset="1" stopColor="var(--sky-low)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <rect x={0} y={skyH} width={W} height={GROUND} fill="var(--bg)" />
        <g clipPath="url(#horizon-ground)">
          {scene.waters.map((d, i) => (
            <path key={`w${i}`} d={d} fill="var(--decor-water)" opacity={0.35} />
          ))}
          {scene.uniques.map((u) => (
            <g
              key={`u:${u.unique.kind}:${Math.round(u.baseY)}`}
              opacity={u.opacity}
              transform={`translate(${u.x} ${u.y}) scale(${u.f}) translate(${-u.baseX} ${-u.baseY})`}
            >
              <UniqueArt unique={u.unique} />
            </g>
          ))}
          {scene.items.map((it, i) => (
            <g
              key={`i${i}:${Math.round(it.baseY)}`}
              opacity={it.opacity * (it.item.far ? 0.6 : 1)}
              transform={`translate(${it.x} ${it.y}) scale(${it.f}) translate(${-it.baseX} ${-it.baseY})`}
            >
              <Sprite {...it.item} />
            </g>
          ))}
          {scene.separators.map((s) => (
            <g key={`s${s.label}`} opacity={s.opacity * (s.dim ? 0.7 : 1)}>
              <line x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} stroke="var(--hairline)" strokeWidth={1} />
            </g>
          ))}
          {scene.tracks.map((t) => (
            <g key={`t${t.level}`}>
              <path d={t.edge} fill="var(--ballast-edge)" />
              <path d={t.ballast} fill="var(--ballast)" />
              <path d={t.sleepers} fill="var(--sleeper)" />
              <path d={t.rail} fill="var(--rail)" />
              {t.painted && <path d={t.painted} fill="var(--accent)" />}
              <path d={t.inner} fill="var(--ballast)" />
              <path d={t.sleepersIn} fill="var(--sleeper)" />
            </g>
          ))}
          {scene.train && (
            <g
              transform={`translate(${scene.train.x} ${scene.train.y}) rotate(${scene.train.angle}) scale(${scene.train.f})`}
              opacity={fade(scene.train.f, 0.3, 0.3)}
            >
              <rect x={-TRAIN_LENGTH / 2} y={-5.5} width={TRAIN_LENGTH} height={11} rx={3} fill={trainColor(scene.train.level)} />
            </g>
          )}
          {scene.nodes.map((g) => (
            <Disc key={g.node.id} g={g} />
          ))}
          {scene.nodes.map((g) => {
            const glyph = glyphOf(g.node);
            const dim = g.node.kind !== "city" && g.node.dim ? 0.45 : 1;
            return (
              <g key={`g:${g.node.id}`} opacity={dim}>
                {g.glyph > 0 && (
                  <text
                    x={0}
                    y={0}
                    transform={`translate(${g.x} ${g.y}) scale(${g.f})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={g.node.r * 0.72}
                    fill={glyph.color}
                    opacity={g.glyph}
                    style={{ fontFamily: "var(--font-jp)" }}
                  >
                    {glyph.text}
                  </text>
                )}
                {g.label && (
                  <g transform={`translate(${g.label.x} ${g.label.y}) scale(${g.label.f})`} opacity={g.label.opacity}>
                    <text
                      y={17}
                      textAnchor={g.node.side === "right" ? "start" : "end"}
                      fontSize={16}
                      fill="var(--text)"
                      style={{ fontFamily: "var(--font-jp)" }}
                    >
                      {labelOf(g.node).word}
                    </text>
                    <text y={38} textAnchor={g.node.side === "right" ? "start" : "end"} fontSize={12} fill="var(--text-muted)">
                      {labelOf(g.node).line}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
        <rect x={0} y={skyH} width={W} height={GROUND * 0.5} fill="url(#horizon-haze)" />
      </svg>
      {/* La bande arrête les touchers : les arrêts cachés dessous ne se touchent pas. */}
      <div className="pointer-events-auto absolute inset-x-0 top-0" style={{ height: junction }} />
    </div>
  );
}
