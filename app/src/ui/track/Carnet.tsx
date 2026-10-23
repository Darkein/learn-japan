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
/** En cascade, les feuilles se contentent de moins de bandes : moins de pages à monter d'un coup. */
const CASCADE_STRIPS = 4;
/** Courbure maximale de la feuille (degrés entre la reliure et le bord libre), à mi-course. */
const CURL = 110;
/** Saut lointain (marque-page) : au plus tant de feuilles tournent, l'une après l'autre. */
const MAX_LEAVES = 3;
const LEAF_STAGGER_MS = 110;
/** Ruban du marque-page de l'omikuji (les routes prennent la couleur de leur train). */
const FORTUNE_RIBBON = "#6b6255";
/** Part visible du marque-page actif au-dessus du carnet, et part glissée sous les pages. */
const RIBBON_SHOWN = 34;
const RIBBON_TUCK = 12;

type Content =
  | { kind: "route"; route: Route; stations: Route["stations"]; part: number }
  | { kind: "fortune"; items: FortuneRecord[]; part: number; count: number };
/** Une page blanche complète la dernière double page d'une section : elle en garde l'en-tête. */
type Page = Content | { kind: "blank"; of: Content };

/** Des feuilles qui tournent entre la double page `lo` et la double page `hi` : à `p` = 0 elles
    sont à droite (on voit `lo`), à `p` = 1 à gauche (on voit `hi`). Un saut lointain fait
    tourner plusieurs feuilles en cascade, par les doubles pages `stops` (de `lo` à `hi`). */
interface Flip {
  lo: number;
  hi: number;
  stops: number[];
  p: number;
  /** Double page visée par un geste fini (bouton, marque-page, feuille lâchée). */
  target?: number;
  /** Sens du geste qui a soulevé la feuille (1 : vers `hi`) : le bord libre mène, la feuille se
      courbe derrière. Fixé pour toute la course : une feuille lâchée qui retombe rejoue la même
      courbure à l'envers. */
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
/** Départ franc, arrivée en douceur : la feuille part dès le toucher et se pose. */
const ease = (t: number) => 1 - (1 - t) ** 3;

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
    const section = (list: Content[]) => {
      out.push(...list);
      if (list.length % 2) out.push({ kind: "blank", of: list[list.length - 1] });
    };
    for (const route of routes) {
      const parts = chunk(route.stations.slice(1), SLOTS);
      section(parts.map((stations, part) => ({ kind: "route", route, stations, part })));
    }
    const parts = chunk(fortunes, SLOTS);
    section(parts.map((items, part) => ({ kind: "fortune", items, part, count: fortunes.length })));
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
    const aim = { ...f, target: target ? f.hi : f.lo };
    show(aim);
    // L'horloge part à la première image affichée : le montage des feuilles ne mange pas le
    // début de la course.
    let t0 = -1;
    // Une cascade avance d'un pas régulier : chaque feuille a sa propre accélération (leafP).
    const curve = f.stops.length > 2 ? (t: number) => t : ease;
    const step = (now: number) => {
      if (t0 < 0) t0 = now;
      const t = clamp01((now - t0) / ms);
      show({ ...aim, p: from + (target - from) * curve(t) });
      if (t < 1) raf.current = requestAnimationFrame(step);
      else done();
    };
    raf.current = requestAnimationFrame(step);
  }

  function go(to: number) {
    if (flipRef.current || to === spread || to < 0 || to >= spreads) return;
    if (reducedMotion()) return setSpread(to);
    const fwd = to > spread;
    const [lo, hi] = fwd ? [spread, to] : [to, spread];
    const k = Math.min(hi - lo, MAX_LEAVES);
    const stops = Array.from({ length: k + 1 }, (_, j) => lo + Math.round((j * (hi - lo)) / k));
    show({ lo, hi, stops, p: fwd ? 0 : 1, dir: fwd ? 1 : -1 });
    settle(fwd ? 1 : 0, TURN_MS + (k - 1) * LEAF_STAGGER_MS);
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
    const [lo, hi] = d.dir > 0 ? [spread, spread + 1] : [spread - 1, spread];
    show({ lo, hi, stops: [lo, hi], p: progress(d, e.clientX), dir: d.dir });
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

  // Marque-pages : un par niveau, à la couleur de son train, et un pour l'omikuji.
  const marks = pages.flatMap((p, i) =>
    p.kind !== "blank" && p.part === 0
      ? [
          p.kind === "route"
            ? { spread: i / 2, key: `n${p.route.level}`, label: `N${p.route.level}`, name: p.route.name, color: p.route.trainColor }
            : { spread: i / 2, key: "fortune", label: "吉", name: "Tampons de fortune", color: FORTUNE_RIBBON },
        ]
      : [],
  );
  // Le marque-page actif ne change qu'une fois le tour décidé (bouton, marque-page, feuille
  // lâchée) : une feuille tenue qui hésite autour de la moitié ne le fait pas clignoter.
  const shownSpread = flip?.target ?? spread;
  const activeMark = marks.filter((m) => m.spread <= shownSpread).pop()?.spread;

  if (!pages.length) return null;
  const left = pages[2 * (flip ? flip.lo : spread)];
  const right = pages[2 * (flip ? flip.hi : spread) + 1];
  const pageProps: PageProps = { stamps, stampSize, onOpenCity };

  return (
    <div className="flex flex-col gap-3">
      {/* Les marque-pages sont glissés sous les pages : leur pied passe derrière le carnet
          (RIBBON_TUCK), et la rangée a une hauteur fixe pour que ce pied ne bouge pas quand
          un ruban grandit et l'autre rétrécit. */}
      <div className="relative" style={{ paddingTop: RIBBON_SHOWN }}>
      <div
        className="absolute top-0 right-3 flex items-end gap-1"
        style={{ height: RIBBON_SHOWN + RIBBON_TUCK }}
        role="tablist"
        aria-label="Marque-pages du carnet"
      >
        {marks.map((m) => {
          const active = activeMark === m.spread;
          return (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={m.name}
              onClick={() => go(m.spread)}
              className="carnet-ribbon cursor-pointer font-jp"
              style={{ background: m.color, height: (active ? RIBBON_SHOWN : RIBBON_SHOWN - 10) + RIBBON_TUCK }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div
        ref={book}
        className="carnet relative z-10 grid grid-cols-2 select-none"
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
        {flip && <Leaves flip={flip} pages={pages} pageProps={pageProps} />}
      </div>
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

interface PageProps {
  stamps: Record<number, number>;
  stampSize: number;
  onOpenCity: Props["onOpenCity"];
}

/**
 * Les feuilles en mouvement. Une feuille j tourne de la double page stops[j] à stops[j + 1] ;
 * en cascade, chacune part un peu après la précédente (à l'envers en marche arrière). Seules
 * comptent les feuilles en l'air et la feuille du dessus de chaque pile ; posée, celle-ci se
 * dessine à plat, d'une seule page, sans les bandes.
 */
function Leaves({ flip, pages, pageProps }: { flip: Flip; pages: Page[]; pageProps: PageProps }) {
  const k = flip.stops.length - 1;
  const total = TURN_MS + (k - 1) * LEAF_STAGGER_MS;
  const leafP = (j: number) => (k === 1 ? flip.p : ease(clamp01((flip.p * total - j * LEAF_STAGGER_MS) / TURN_MS)));
  const ps = Array.from({ length: k }, (_, j) => leafP(j));
  const topRight = ps.indexOf(0);
  const topLeft = ps.lastIndexOf(1);
  return (
    <>
      {ps.map((p, j) => {
        if ((p === 0 && j !== topRight) || (p === 1 && j !== topLeft)) return null;
        const a = flip.stops[j];
        const b = flip.stops[j + 1];
        // À droite, la première feuille est dessus ; à gauche, la dernière posée.
        const z = p < 0.5 ? k - j : k + 1 + j;
        if (p === 0 || p === 1) {
          return (
            <div key={j} className={`absolute top-0 bottom-0 w-1/2 ${p ? "left-0" : "right-0"}`} style={{ zIndex: z }}>
              {p ? (
                <PageView page={pages[2 * b]} side="left" number={2 * b + 1} {...pageProps} />
              ) : (
                <PageView page={pages[2 * a + 1]} side="right" number={2 * a + 2} {...pageProps} />
              )}
            </div>
          );
        }
        return (
          <Leaf
            key={j}
            p={p}
            dir={flip.dir}
            strips={k === 1 ? STRIPS : CASCADE_STRIPS}
            z={z}
            front={(col) => <PageView page={pages[2 * a + 1]} side="right" number={2 * a + 2} col={col} {...pageProps} />}
            back={(col) => <PageView page={pages[2 * b]} side="left" number={2 * b + 1} col={col} {...pageProps} />}
          />
        );
      })}
    </>
  );
}

/**
 * La feuille qui tourne : des bandes imbriquées, chacune pivotant autour du bord de la
 * précédente. À plat aux deux bouts de la course, courbée au milieu, le bord libre en tête.
 * Recto : une page de droite ; verso : la page de gauche de la double page d'après.
 */
function Leaf({
  p,
  dir,
  strips,
  z,
  front,
  back,
}: {
  p: number;
  dir: 1 | -1;
  strips: number;
  z: number;
  /** Contenu d'une face, réduit à la colonne de tampons que couvre la bande. */
  front: (col: 0 | 1) => ReactNode;
  back: (col: 0 | 1) => ReactNode;
}) {
  const theta = 180 * p;
  const curl = Math.sin(p * Math.PI) * CURL * dir;
  const angles = Array.from({ length: strips }, (_, i) =>
    Math.min(180, Math.max(0, theta + curl * (i / (strips - 1) - 0.5))),
  );
  // Ombre en dégradé continu d'une bande à l'autre : plus la feuille se détourne, plus elle
  // s'assombrit (recto avant d'être debout, verso après).
  const dark = (a: number, back: boolean) => `rgba(0, 0, 0, ${(((back ? 180 - a : a) / 90) * 0.16).toFixed(3)})`;
  const shade = (i: number, back: boolean) => {
    const a = angles[i];
    const b = angles[Math.min(i + 1, strips - 1)];
    return { background: `linear-gradient(to ${back ? "left" : "right"}, ${dark(a, back)}, ${dark(b, back)})` };
  };
  let node: ReactNode = null;
  for (let i = strips - 1; i >= 0; i--) {
    const turn = angles[i] - (i ? angles[i - 1] : 0);
    const face = "absolute top-0 bottom-0 left-0 overflow-hidden";
    // Une bande déborde d'un pixel sur la suivante : pas de jour entre elles.
    const faceStyle = { right: -1, backfaceVisibility: "hidden" } as const;
    const slice = (offset: number) => ({ width: `${strips * 100}%`, left: `${-offset * 100}%` });
    // Une bande ne recopie que la colonne qu'elle couvre, et une face n'est montée qu'à
    // l'approche du moment où elle se voit (recto avant 90°, verso après) : le travail
    // s'étale sur la course au lieu de tout peser au départ.
    const colOf = (offset: number): 0 | 1 => ((offset + 0.5) / strips < 0.5 ? 0 : 1);
    node = (
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: i ? "100%" : 0,
          width: i ? "100%" : `${100 / strips}%`,
          transformOrigin: "left center",
          transformStyle: "preserve-3d",
          transform: `rotateY(${-turn}deg)`,
        }}
      >
        <div className={face} style={faceStyle}>
          <div className="absolute top-0 bottom-0" style={slice(i)}>
            {angles[i] < 100 && front(colOf(i))}
          </div>
          <span className="carnet-shade" style={shade(i, false)} />
        </div>
        <div className={face} style={{ ...faceStyle, transform: "rotateY(180deg)" }}>
          <div className="absolute top-0 bottom-0" style={slice(strips - 1 - i)}>
            {angles[i] > 80 && back(colOf(strips - 1 - i))}
          </div>
          <span className="carnet-shade" style={shade(i, true)} />
        </div>
        {node}
      </div>
    );
  }
  return (
    <div className="absolute top-0 right-0 bottom-0 w-1/2" style={{ transformStyle: "preserve-3d", zIndex: z }}>
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
  col,
}: PageProps & {
  page: Page;
  side: "left" | "right";
  number: number;
  /** Seule colonne à dessiner (bande d'une feuille qui tourne) ; l'autre garde sa place, vide. */
  col?: 0 | 1;
}) {
  const shown = (i: number) => col === undefined || i % 2 === col;
  // En-tête de la double page : la route à gauche, le compte de ses tampons à droite.
  const head = page.kind === "blank" ? page.of : page;
  const cell = "flex min-w-0 flex-col items-center justify-start gap-1 pt-1";
  const caption = "line-clamp-2 max-w-full text-center text-xs leading-tight text-muted [overflow-wrap:anywhere]";
  return (
    <div className={`carnet-page carnet-page-${side} flex h-full flex-col gap-2 px-3 pt-3 pb-2`}>
      <div className={`flex h-5 items-baseline gap-2 text-xs ${side === "left" ? "justify-start" : "justify-end"}`}>
        {side === "left" ? (
          <span className="truncate">
            <span className="font-jp text-text">{head.kind === "route" ? head.route.kanji : "おみくじ"}</span>
            <span className="text-muted"> {head.kind === "route" ? `N${head.route.level}` : ""}</span>
          </span>
        ) : head.kind === "route" ? (
          <span className="text-muted tabular-nums" aria-label={`${stamps[head.route.level] ?? 0} tampons sur ${head.route.stations.length - 1}`}>
            <span className="text-text">{stamps[head.route.level] ?? 0}</span>/{head.route.stations.length - 1}
          </span>
        ) : (
          <span className="text-muted tabular-nums">
            <span className="text-text">{head.count}</span> 印
          </span>
        )}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-x-1 gap-y-2" style={{ gridTemplateRows: `repeat(3, ${stampSize + 40}px)` }}>
        {page.kind === "route" &&
          page.stations.map((s, i) => {
            if (!shown(i)) return <span key={s.index} />;
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
          page.items.map((f, i) =>
            !shown(i) ? (
              <span key={f.date} />
            ) : (
            <span key={f.date} className={cell} title={f.date}>
              <FortuneStamp kanji={fortuneById(f.fortune as OmikujiFortune).kanji} size={Math.round(stampSize * 0.85)} />
              <span className={caption}>{f.date.slice(5).replace("-", "/")}</span>
            </span>
            ),
          )}
      </div>

      <span className={`text-xs text-muted tabular-nums ${side === "left" ? "self-start" : "self-end"}`}>{number}</span>
    </div>
  );
});
