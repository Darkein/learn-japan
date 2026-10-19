import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { Route } from "../../data/routes";
import type { OmikujiFortune } from "../../lib/db";
import { fortuneById } from "../../lib/omikuji";
import type { FortuneStamp as FortuneRecord } from "../../lib/tokaido";
import { cityOf } from "../../lib/trackInput";
import { IconArrowLeft, IconArrowRight } from "../kit/Icon";
import { CityStamp, FortuneStamp } from "./Stamp";

/** Tampons par page (2 × 3). */
const SLOTS = 6;
/** Durée d'une page tournée d'un geste (bouton, signet). */
const TURN_MS = 700;
/** Bandes verticales de la feuille qui tourne : chacune pivote un peu plus que la précédente,
    la feuille se courbe comme du papier au lieu de tourner d'un bloc. */
const STRIPS = 8;
/** Courbure maximale de la feuille (degrés entre la reliure et le bord libre), à mi-course. */
const CURL = 70;

type Page =
  | { kind: "route"; route: Route; stations: Route["stations"]; part: number }
  | { kind: "fortune"; items: FortuneRecord[]; part: number }
  | { kind: "blank" };

/** Une feuille qui tourne entre la double page `lo` et la double page `hi` : à `p` = 0 elle
    est à droite (on voit `lo`), à `p` = 1 elle est à gauche (on voit `hi`). */
interface Flip {
  lo: number;
  hi: number;
  p: number;
  /** Sens du mouvement (1 : vers `hi`) : le bord libre mène, la feuille se courbe derrière. */
  dir: 1 | -1;
}

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

interface Props {
  /** Routes du carnet, dans l'ordre du voyage. */
  routes: Route[];
  /** Villes atteintes par niveau. */
  stamps: Record<number, number>;
  fortunes: FortuneRecord[];
  /** Niveau de la route en cours : le carnet s'ouvre sur son dernier tampon. */
  currentLevel: number;
  onOpenCity: (level: number, index: number, stamped: boolean) => void;
}

/**
 * Le carnet de tampons (SPEC §5c.5) : un vrai carnet ouvert, deux pages côte à côte, six
 * tampons par page. Chaque route (et l'omikuji) commence sur une double page. La feuille de
 * droite tourne autour de la reliure : elle suit le doigt qui la tire, ou tourne seule
 * (flèches, signets, glissé rapide).
 */
export function Carnet({ routes, stamps, fortunes, currentLevel, onOpenCity }: Props) {
  const pages = useMemo(() => {
    const out: Page[] = [];
    const section = (list: Page[]) => {
      out.push(...list);
      if (list.length % 2) out.push({ kind: "blank" });
    };
    for (const route of routes) {
      const parts = chunk(route.stations.slice(1), SLOTS);
      section(parts.map((stations, part) => ({ kind: "route", route, stations, part })));
    }
    const parts = chunk(fortunes, SLOTS);
    section(parts.map((items, part) => ({ kind: "fortune", items, part })));
    return out;
  }, [routes, fortunes]);
  const spreads = pages.length / 2;

  const [spread, setSpread] = useState(() => {
    const first = pages.findIndex((p) => p.kind === "route" && p.route.level === currentLevel);
    if (first < 0) return 0;
    return Math.floor((first + Math.floor(Math.max(0, (stamps[currentLevel] ?? 0) - 1) / SLOTS)) / 2);
  });
  const [flip, setFlip] = useState<Flip | null>(null);
  const flipRef = useRef<Flip | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const book = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = book.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // Le tampon prend les deux tiers de sa case : la page garde de l'air autour.
  const stampSize = Math.max(40, Math.min(60, Math.round(((width / 2 - 28) / 2) * 0.66)));

  const show = (f: Flip | null) => {
    flipRef.current = f;
    setFlip(f);
  };
  /** La feuille finit seule sa course jusqu'à `target`, puis la double page change. */
  function settle(target: 0 | 1, ms: number) {
    const f = flipRef.current;
    if (!f) return;
    cancelAnimationFrame(raf.current);
    const done = () => {
      setSpread(target ? f.hi : f.lo);
      show(null);
    };
    if (reducedMotion() || Math.abs(target - f.p) < 0.01) return done();
    const from = f.p;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp01((now - t0) / ms);
      show({ ...f, dir: target > from ? 1 : -1, p: from + (target - from) * ease(t) });
      if (t < 1) raf.current = requestAnimationFrame(step);
      else done();
    };
    raf.current = requestAnimationFrame(step);
  }

  function go(to: number) {
    if (flipRef.current || to === spread || to < 0 || to >= spreads) return;
    if (reducedMotion()) return setSpread(to);
    const fwd = to > spread;
    show(fwd ? { lo: spread, hi: to, p: 0, dir: 1 } : { lo: to, hi: spread, p: 1, dir: -1 });
    settle(fwd ? 1 : 0, TURN_MS);
  }

  // Tirer la feuille : elle suit le doigt ; lâchée, elle tourne ou retombe selon sa position
  // et la vitesse du geste. Un glissé n'ouvre pas le tampon sous le doigt.
  const drag = useRef<{ x0: number; y0: number; dir: 0 | 1 | -1; w: number; trail: { t: number; x: number }[] } | null>(null);
  const swiped = useRef(false);
  const progress = (d: NonNullable<typeof drag.current>, x: number) =>
    d.dir > 0 ? clamp01((d.x0 - x) / d.w) : clamp01(1 - (x - d.x0) / d.w);

  const onPointerDown = (e: PointerEvent) => {
    swiped.current = false;
    if (flipRef.current || !book.current) return;
    drag.current = { x0: e.clientX, y0: e.clientY, dir: 0, w: book.current.clientWidth, trail: [{ t: e.timeStamp, x: e.clientX }] };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.dir === 0) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) drag.current = null; // défilement vertical
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      const dir = dx < 0 ? 1 : -1;
      if (spread + dir < 0 || spread + dir >= spreads) {
        drag.current = null;
        return;
      }
      d.dir = dir;
      swiped.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    d.trail = [...d.trail.filter((s) => e.timeStamp - s.t < 100), { t: e.timeStamp, x: e.clientX }];
    const p = progress(d, e.clientX);
    const prev = flipRef.current;
    const dir = prev && p !== prev.p ? (p > prev.p ? 1 : -1) : d.dir > 0 ? 1 : -1;
    show({ lo: d.dir > 0 ? spread : spread - 1, hi: d.dir > 0 ? spread + 1 : spread, p, dir });
  };
  const release = (e: PointerEvent, cancel = false) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.dir === 0) return;
    const p = progress(d, e.clientX);
    const first = d.trail[0];
    const v = e.timeStamp > first.t ? (e.clientX - first.x) / (e.timeStamp - first.t) : 0; // px/ms, > 0 vers la droite
    // Vers la gauche = vers la double page suivante (p → 1).
    const target: 0 | 1 = cancel ? (d.dir > 0 ? 0 : 1) : v < -0.4 ? 1 : v > 0.4 ? 0 : p > 0.5 ? 1 : 0;
    settle(target, 140 + 460 * Math.abs(target - p));
  };

  // Signets : un par route, et un pour l'omikuji.
  const marks = pages.flatMap((p, i) =>
    p.kind !== "blank" && p.part === 0
      ? [{ spread: i / 2, label: p.kind === "route" ? p.route.kanji : "おみくじ", key: p.kind === "route" ? p.route.level : "fortune" }]
      : [],
  );
  const shownSpread = flip ? (flip.p > 0.5 ? flip.hi : flip.lo) : spread;
  const activeMark = marks.filter((m) => m.spread <= shownSpread).pop()?.spread;

  if (!pages.length) return null;
  const left = pages[2 * (flip ? flip.lo : spread)];
  const right = pages[2 * (flip ? flip.hi : spread) + 1];
  const pageProps = { stamps, stampSize, onOpenCity };

  return (
    <div className="flex flex-col gap-3">
      {marks.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sections du carnet">
          {marks.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={activeMark === m.spread}
              onClick={() => go(m.spread)}
              className={`cursor-pointer rounded-sm border px-2.5 py-1 font-jp text-xs ${
                activeMark === m.spread ? "border-accent text-accent" : "border-hairline text-muted"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div
        ref={book}
        className="carnet relative grid grid-cols-2 select-none"
        style={{ perspective: 1600, touchAction: "pan-y", overflowX: "clip" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => release(e)}
        onPointerCancel={(e) => release(e, true)}
        onClickCapture={(e) => {
          if (swiped.current || flipRef.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <PageView page={left} side="left" number={2 * (flip ? flip.lo : spread) + 1} {...pageProps} />
        <PageView page={right} side="right" number={2 * (flip ? flip.hi : spread) + 2} {...pageProps} />
        {flip && (
          <Leaf
            flip={flip}
            front={<PageView page={pages[2 * flip.lo + 1]} side="right" number={2 * flip.lo + 2} {...pageProps} />}
            back={<PageView page={pages[2 * flip.hi]} side="left" number={2 * flip.hi + 1} {...pageProps} />}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-muted">
        <button
          type="button"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md disabled:cursor-default disabled:opacity-30"
          onClick={() => go(spread - 1)}
          disabled={spread === 0}
          aria-label="Pages précédentes"
        >
          <IconArrowLeft size={20} />
        </button>
        <button
          type="button"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md disabled:cursor-default disabled:opacity-30"
          onClick={() => go(spread + 1)}
          disabled={spread === spreads - 1}
          aria-label="Pages suivantes"
        >
          <IconArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}

/**
 * La feuille qui tourne : des bandes imbriquées, chacune pivotant autour du bord de la
 * précédente. À plat aux deux bouts de la course, courbée au milieu, le bord libre en tête.
 * Recto : la page de droite de `lo` ; verso : la page de gauche de `hi`.
 */
function Leaf({ flip, front, back }: { flip: Flip; front: ReactNode; back: ReactNode }) {
  const theta = 180 * flip.p;
  const curl = Math.sin(flip.p * Math.PI) * CURL * flip.dir;
  const angles = Array.from({ length: STRIPS }, (_, i) =>
    Math.min(180, Math.max(0, theta + curl * (i / (STRIPS - 1) - 0.5))),
  );
  // Ombre en dégradé continu d'une bande à l'autre : plus la feuille se détourne, plus elle
  // s'assombrit (recto avant d'être debout, verso après).
  const dark = (a: number, back: boolean) => `rgba(0, 0, 0, ${(((back ? 180 - a : a) / 90) * 0.16).toFixed(3)})`;
  const shade = (i: number, back: boolean) => {
    const a = angles[i];
    const b = angles[Math.min(i + 1, STRIPS - 1)];
    return { background: `linear-gradient(to ${back ? "left" : "right"}, ${dark(a, back)}, ${dark(b, back)})` };
  };
  let node: ReactNode = null;
  for (let i = STRIPS - 1; i >= 0; i--) {
    const turn = angles[i] - (i ? angles[i - 1] : 0);
    const face = "absolute top-0 bottom-0 left-0 overflow-hidden";
    // Une bande déborde d'un pixel sur la suivante : pas de jour entre elles.
    const faceStyle = { right: -1, backfaceVisibility: "hidden" } as const;
    const slice = (offset: number) => ({ width: `${STRIPS * 100}%`, left: `${-offset * 100}%` });
    node = (
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: i ? "100%" : 0,
          width: i ? "100%" : `${100 / STRIPS}%`,
          transformOrigin: "left center",
          transformStyle: "preserve-3d",
          transform: `rotateY(${-turn}deg)`,
        }}
      >
        <div className={face} style={faceStyle}>
          <div className="absolute top-0 bottom-0" style={slice(i)}>
            {front}
          </div>
          <span className="carnet-shade" style={shade(i, false)} />
        </div>
        <div className={face} style={{ ...faceStyle, transform: "rotateY(180deg)" }}>
          <div className="absolute top-0 bottom-0" style={slice(STRIPS - 1 - i)}>
            {back}
          </div>
          <span className="carnet-shade" style={shade(i, true)} />
        </div>
        {node}
      </div>
    );
  }
  return (
    <div className="absolute top-0 right-0 bottom-0 w-1/2" style={{ transformStyle: "preserve-3d" }}>
      {node}
    </div>
  );
}

/** Décalage stable d'un tampon dans sa case, pour qu'il ait l'air posé à la main. */
function jitter(seed: number): { x: number; y: number } {
  const h = Math.imul(seed + 7, 0x9e3779b1) >>> 0;
  return { x: ((h >>> 8) % 7) - 3, y: ((h >>> 16) % 5) - 2 };
}

const PageView = memo(function PageView({
  page,
  side,
  number,
  stamps,
  stampSize,
  onOpenCity,
}: {
  page: Page;
  side: "left" | "right";
  number: number;
  stamps: Record<number, number>;
  stampSize: number;
  onOpenCity: Props["onOpenCity"];
}) {
  const cell = "flex min-w-0 flex-col items-center justify-start gap-1 pt-1";
  const caption = "line-clamp-2 text-center text-xs leading-tight text-muted";
  return (
    <div className={`carnet-page carnet-page-${side} flex h-full flex-col gap-2 px-3 pt-3 pb-2`}>
      <div className="flex h-5 items-baseline justify-between gap-2 text-xs">
        {page.kind === "route" && <span className="truncate font-jp text-text">{page.route.kanji}</span>}
        {page.kind === "fortune" && <span className="truncate font-jp text-text">おみくじ</span>}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-x-1 gap-y-2" style={{ gridTemplateRows: `repeat(3, ${stampSize + 40}px)` }}>
        {page.kind === "route" &&
          page.stations.map((s) => {
            const stamped = s.index <= (stamps[page.route.level] ?? 0);
            const city = cityOf(page.route.level, s.index) ?? { kanji: s.kanji, size: "ville" as const, index: s.index };
            const j = jitter(page.route.level * 100 + s.index);
            return (
              <button
                key={s.index}
                type="button"
                className={`${cell} cursor-pointer`}
                aria-label={`${s.romaji}${stamped ? ", tampon obtenu" : ", à venir"}`}
                onClick={() => onOpenCity(page.route.level, s.index, stamped)}
              >
                <CityStamp
                  city={city}
                  size={stampSize}
                  empty={!stamped}
                  style={stamped ? { translate: `${j.x}px ${j.y}px` } : undefined}
                />
                <span className={caption}>{s.romaji}</span>
              </button>
            );
          })}
        {page.kind === "fortune" &&
          page.items.map((f) => (
            <span key={f.date} className={cell} title={f.date}>
              <FortuneStamp kanji={fortuneById(f.fortune as OmikujiFortune).kanji} size={Math.round(stampSize * 0.85)} />
              <span className={caption}>{f.date.slice(5).replace("-", "/")}</span>
            </span>
          ))}
      </div>

      <span className={`text-xs text-muted tabular-nums ${side === "left" ? "self-start" : "self-end"}`}>{number}</span>
    </div>
  );
});
