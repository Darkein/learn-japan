import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pathD, TRAIN_LENGTH, type TrackLayout, type TrackNode, type TrackSection } from "../../lib/track";
import { cancelScrollRestore } from "../useHashRoute";
import { IconLock } from "../kit/Icon";
import { Rails } from "./Rails";
import { TrackNodeView } from "./TrackNodeView";

/** Hauteur d'une tranche de rendu : la voie entière ferait des dizaines de milliers de px. */
const SLICE = 900;
/** Mémoire de l'arrêt du train vu en dernier (confort par appareil, SPEC §5c.3). */
const TRAIN_KEY = "track.train";

interface Props {
  layout: TrackLayout;
  trainColor: (level: number) => string;
  /** Contenu de la bulle de l'étape à faire. */
  bubble?: ReactNode;
  /** Ligne secondaire d'un nœud (durée d'une étape à venir). */
  metaOf?: (node: TrackNode) => string | undefined;
  onTapNode: (node: TrackNode) => void;
  /** Contenu d'une fin de route (chantier 6.4 : carte de fin et correspondance). */
  renderMarker?: (m: TrackLayout["markers"][number]) => ReactNode;
  /** Section de leçon au centre de l'écran (bandeau collant). */
  onSection?: (s: TrackSection | undefined) => void;
  /** Libellé du bouton de retour à l'étape à faire. */
  backLabel?: string;
}

function readTrain(): { level: number; dist: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TRAIN_KEY) ?? "null");
    return v && typeof v.dist === "number" ? v : null;
  } catch {
    return null;
  }
}

function writeTrain(v: { level: number; dist: number }): void {
  try {
    localStorage.setItem(TRAIN_KEY, JSON.stringify(v));
  } catch {
    // stockage indisponible (navigation privée) : le train se pose simplement à son arrêt.
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Le train vu du dessus (36 × 11 px), nez vers l'avant (SPEC §5c.3). */
function TrainSprite({ color }: { color: string }) {
  return (
    <svg width={TRAIN_LENGTH} height={11} viewBox="0 0 46 14" aria-hidden="true">
      <rect x="0" y="2" width="18" height="10" rx="2.5" fill={color} />
      <path d="M20 2 H31 Q46 3 46 7 Q46 11 31 12 H20 Z" fill={color} />
      <path d="M2 7 H17 M22 7 H34" stroke="var(--on-accent)" strokeWidth="1" opacity="0.7" />
      <path d="M37 4.2 Q42.5 5 42.5 7 Q42.5 9 37 9.8" stroke="var(--on-accent)" strokeWidth="1.3" fill="none" />
    </svg>
  );
}

/**
 * La voie de l'accueil (SPEC §5c.2) : rails, arrêts, villes, séparateurs, train et bulle.
 * Toute la voie a sa hauteur, mais seules les tranches proches de l'écran sont rendues.
 * S'ouvre centrée sur l'étape à faire ; le train y roule depuis son dernier arrêt vu.
 */
export function Track({ layout, trainColor, bubble, metaOf, onTapNode, renderMarker, onSection, backLabel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, bottom: SLICE * 2 });
  const [curVisible, setCurVisible] = useState(true);
  const { current, train, paths, width } = layout;

  // Le train : il part de son dernier arrêt vu (même route, plus en arrière), puis roule.
  const [trainDist, setTrainDist] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [painted, setPainted] = useState<Record<number, number>>({});
  // Point de départ du trajet : l'arrêt vu en dernier, lu une fois au montage, puis l'arrêt
  // où le train s'est posé. L'effet reste rejouable (StrictMode, mise en page recalculée) :
  // il ne déplace ce point qu'une fois le trajet fini.
  const lastSeen = useRef(readTrain());
  const paintedKey = paths.map((p) => `${p.level}:${Math.round(p.painted)}`).join(",");
  useEffect(() => {
    const target = Object.fromEntries(paths.map((p) => [p.level, p.painted]));
    if (!train) {
      setPainted(target);
      setTrainDist(null);
      return;
    }
    const prev = lastSeen.current;
    writeTrain(train);
    const from = prev && prev.level === train.level && prev.dist < train.dist ? prev.dist : null;
    if (from === null || reducedMotion()) {
      lastSeen.current = train;
      setDuration(0);
      setTrainDist(train.dist);
      setPainted(target);
      return;
    }
    // Plusieurs étapes d'un coup : un seul trajet, plafonné à 3 s.
    const d = Math.min(3, Math.max(1.6, (train.dist - from) / 260));
    setDuration(0);
    setTrainDist(from);
    setPainted({ ...target, [train.level]: from + TRAIN_LENGTH / 2 });
    const t = window.setTimeout(() => {
      lastSeen.current = train;
      setDuration(d);
      setTrainDist(train.dist);
      setPainted(target);
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [train?.level, train?.dist, paintedKey]);

  // Ouverture centrée sur l'étape à faire.
  const centered = useRef(false);
  useLayoutEffect(() => {
    if (centered.current || !box.current) return;
    centered.current = true;
    cancelScrollRestore();
    const target = current ? current.y : 0;
    const top = box.current.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top + target - window.innerHeight * 0.42));
  }, [current]);

  // Tranche visible, bandeau collant, bouton de retour.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!box.current) return;
      const top = box.current.getBoundingClientRect().top;
      const vh = window.innerHeight;
      const a = Math.floor((-top - vh) / SLICE) * SLICE;
      const b = Math.ceil((-top + 2 * vh) / SLICE) * SLICE;
      setView((v) => (v.top === a && v.bottom === b ? v : { top: Math.max(0, a), bottom: Math.max(SLICE, b) }));
      const mid = -top + vh * 0.42;
      onSection?.(layout.sections.find((s) => mid >= s.y0 && mid < s.y1));
      if (current) {
        const y = top + current.y;
        setCurVisible(y > -40 && y < vh + 40);
      }
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
  }, [layout, current, onSection]);

  const visibleNodes = useMemo(
    () => layout.nodes.filter((n) => n.y >= view.top - 80 && n.y <= view.bottom + 80),
    [layout.nodes, view],
  );
  const trainPath = useMemo(() => {
    const p = train && paths.find((q) => q.level === train.level);
    return p ? pathD(p) : null;
  }, [train, paths]);

  function scrollToCurrent() {
    if (!box.current || !current) return;
    const top = box.current.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + current.y - window.innerHeight * 0.42, behavior: reducedMotion() ? "auto" : "smooth" });
  }

  return (
    <div ref={box} className="relative" style={{ height: layout.height, width }}>
      <Rails paths={paths} width={width} y0={view.top} y1={view.bottom} painted={painted} duration={duration} />

      {layout.markers
        .filter((m) => m.y >= view.top - 600 && m.y <= view.bottom + 200)
        .map((m) =>
          m.kind === "lesson" ? (
            <div
              key={`l:${m.lessonId}`}
              className="pointer-events-none absolute left-4 right-4 flex items-center gap-2.5"
              style={{ top: m.y - 12 }}
            >
              <span className="h-px flex-1 bg-hairline" />
              <span
                className="flex items-center gap-2 bg-bg px-2.5 py-1 text-xs uppercase tracking-wide text-muted"
                style={{ opacity: m.dim ? 0.7 : 1 }}
              >
                {m.dim && <IconLock size={13} />}
                Leçon {m.number}
              </span>
              <span className="h-px flex-1 bg-hairline" />
            </div>
          ) : (
            <div key={`${m.kind}:${m.level}`} className="absolute left-0 right-0" style={{ top: m.y, height: m.height }}>
              {renderMarker?.(m)}
            </div>
          ),
        )}

      {visibleNodes.map((n) => (
        <TrackNodeView key={n.id} node={n} width={width} meta={metaOf?.(n)} onTap={onTapNode} />
      ))}

      {trainPath && trainDist !== null && train && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0"
          style={{
            width: TRAIN_LENGTH,
            height: 11,
            offsetPath: `path("${trainPath}")`,
            offsetDistance: `${trainDist}px`,
            offsetRotate: "auto",
            transition: duration ? `offset-distance ${duration}s cubic-bezier(.45,0,.25,1)` : undefined,
          }}
        >
          <TrainSprite color={trainColor(train.level)} />
        </div>
      )}

      {bubble && layout.bubble && (
        <div
          className="absolute flex flex-col gap-1.5 rounded-md border border-hairline bg-surface p-3.5 shadow-elev"
          style={{ left: layout.bubble.x, top: layout.bubble.y, width: layout.bubble.w }}
        >
          {bubble}
        </div>
      )}

      {current && !curVisible && (
        <button
          type="button"
          onClick={scrollToCurrent}
          className="fixed left-1/2 z-30 -translate-x-1/2 cursor-pointer rounded-sm border border-hairline-strong bg-surface px-4 py-2.5 text-sm text-text shadow-elev"
          style={{ bottom: "calc(4.5rem + var(--safe-b, 0px))" }}
        >
          {backLabel ?? "Revenir à l'étape à faire"}
        </button>
      )}
    </div>
  );
}
