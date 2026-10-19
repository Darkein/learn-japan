import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Route } from "../../data/routes";
import type { OmikujiFortune } from "../../lib/db";
import { fortuneById } from "../../lib/omikuji";
import type { FortuneStamp as FortuneRecord } from "../../lib/tokaido";
import { cityOf } from "../../lib/trackInput";
import { IconArrowLeft, IconArrowRight } from "../kit/Icon";
import { CityStamp, FortuneStamp } from "./Stamp";

/** Cases par page : 2 × 3 tampons de ville, 3 × 3 tampons de fortune, de même hauteur (h-29)
    pour que toutes les pages aient la taille du carnet. */
const CITY_SLOTS = 6;
const FORTUNE_SLOTS = 9;
/** Durée d'une page qui tourne (doit suivre `.page-turn-*` dans global.css). */
const TURN_MS = 650;

type Page =
  | { kind: "route"; route: Route; stations: Route["stations"]; part: number; parts: number }
  | { kind: "fortune"; items: FortuneRecord[]; part: number; parts: number };

function chunk<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

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
 * Le carnet de tampons (SPEC §5c.5) : un vrai carnet, une page à la fois, six tampons par page.
 * Les pages tournent autour de la reliure (bouton, glissé du doigt ou signet) ; les cases à
 * venir sont des ronds en pointillés.
 */
export function Carnet({ routes, stamps, fortunes, currentLevel, onOpenCity }: Props) {
  const pages = useMemo(() => {
    const out: Page[] = [];
    for (const route of routes) {
      const parts = chunk(route.stations.slice(1), CITY_SLOTS);
      parts.forEach((stations, part) => out.push({ kind: "route", route, stations, part, parts: parts.length }));
    }
    const parts = chunk(fortunes, FORTUNE_SLOTS);
    parts.forEach((items, part) => out.push({ kind: "fortune", items, part, parts: parts.length }));
    return out;
  }, [routes, fortunes]);

  const [page, setPage] = useState(() => {
    const first = pages.findIndex((p) => p.kind === "route" && p.route.level === currentLevel);
    if (first < 0) return 0;
    return first + Math.floor(Math.max(0, (stamps[currentLevel] ?? 0) - 1) / CITY_SLOTS);
  });
  const [turn, setTurn] = useState<{ to: number; dir: 1 | -1 } | null>(null);
  const shown = Math.min(page, pages.length - 1);

  function go(to: number) {
    if (turn || to === shown || to < 0 || to >= pages.length) return;
    if (reducedMotion()) return setPage(to);
    setTurn({ to, dir: to > shown ? 1 : -1 });
  }

  // Glisser vers la gauche tourne la page ; un glissé n'ouvre pas le tampon sous le doigt.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
    swiped.current = true;
    go(shown + (dx < 0 ? 1 : -1));
  };

  // Signets : un par route, et un pour l'omikuji.
  const marks = pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.part === 0)
    .map(({ p, i }) => ({ i, label: p.kind === "route" ? p.route.kanji : "おみくじ", key: p.kind === "route" ? p.route.level : "fortune" }));
  const sectionOf = (i: number) => marks.filter((m) => m.i <= i).pop()?.i;

  if (!pages.length) return null;
  const under = turn ? (turn.dir > 0 ? turn.to : shown) : shown;
  const over = turn ? (turn.dir > 0 ? shown : turn.to) : null;

  return (
    <div className="flex flex-col gap-3">
      {marks.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sections du carnet">
          {marks.map((m) => {
            const active = sectionOf(turn?.to ?? shown) === m.i;
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => go(m.i)}
                className={`cursor-pointer rounded-sm border px-2.5 py-1 font-jp text-xs ${
                  active ? "border-accent text-accent" : "border-hairline text-muted"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      )}

      <div
        className="relative select-none"
        style={{ perspective: 1800, touchAction: "pan-y", overflowX: "clip" }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClickCapture={(e) => {
          if (swiped.current || turn) {
            e.stopPropagation();
            e.preventDefault();
          }
          swiped.current = false;
        }}
      >
        <PageView page={pages[under]} number={under + 1} stamps={stamps} onOpenCity={onOpenCity} />
        {turn && over !== null && (
          <div
            className={`absolute inset-0 ${turn.dir > 0 ? "page-turn-next" : "page-turn-prev"}`}
            style={{ animationDuration: `${TURN_MS}ms` }}
            onAnimationEnd={(e) => {
              if (e.target !== e.currentTarget) return;
              setPage(turn.to);
              setTurn(null);
            }}
          >
            <PageView page={pages[over]} number={over + 1} stamps={stamps} onOpenCity={onOpenCity} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-muted">
        <button
          type="button"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md disabled:cursor-default disabled:opacity-30"
          onClick={() => go(shown - 1)}
          disabled={shown === 0}
          aria-label="Page précédente"
        >
          <IconArrowLeft size={20} />
        </button>
        <span className="text-xs tabular-nums">
          {(turn?.to ?? shown) + 1} / {pages.length}
        </span>
        <button
          type="button"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md disabled:cursor-default disabled:opacity-30"
          onClick={() => go(shown + 1)}
          disabled={shown === pages.length - 1}
          aria-label="Page suivante"
        >
          <IconArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}

/** Décalage stable d'un tampon dans sa case, pour qu'il ait l'air posé à la main. */
function jitter(seed: number): { x: number; y: number } {
  const h = Math.imul(seed + 7, 0x9e3779b1) >>> 0;
  return { x: ((h >>> 8) % 9) - 4, y: ((h >>> 16) % 7) - 3 };
}

function PageView({
  page,
  number,
  stamps,
  onOpenCity,
}: {
  page: Page;
  number: number;
  stamps: Record<number, number>;
  onOpenCity: Props["onOpenCity"];
}) {
  const slots = page.kind === "route" ? CITY_SLOTS : FORTUNE_SLOTS;
  const filler = Array.from({ length: slots - (page.kind === "route" ? page.stations.length : page.items.length) });
  return (
    <div className="carnet-page flex flex-col gap-3 rounded-r-md px-4 pt-3.5 pb-2.5 pl-6">
      <div className="flex items-baseline justify-between gap-3">
        {page.kind === "route" ? (
          <span className="text-sm text-text">
            <span className="font-jp">{page.route.kanji}</span> {page.route.name}
            <span className="text-xs text-muted"> · N{page.route.level}</span>
          </span>
        ) : (
          <span className="text-sm text-text">
            <span className="font-jp">おみくじ</span> Tampons de fortune
          </span>
        )}
        {page.parts > 1 && (
          <span className="text-xs text-muted tabular-nums">
            {page.part + 1}/{page.parts}
          </span>
        )}
      </div>

      <div className={`grid ${page.kind === "route" ? "grid-cols-2" : "grid-cols-3"} border-t border-l border-hairline`}>
        {page.kind === "route"
          ? page.stations.map((s) => {
              const stamped = s.index <= (stamps[page.route.level] ?? 0);
              const city = cityOf(page.route.level, s.index) ?? { kanji: s.kanji, size: "ville" as const, index: s.index };
              const j = jitter(page.route.level * 100 + s.index);
              return (
                <button
                  key={s.index}
                  type="button"
                  className="flex h-29 cursor-pointer flex-col items-center justify-center gap-1.5 border-r border-b border-hairline px-1"
                  aria-label={`${s.romaji}${stamped ? ", tampon obtenu" : ", à venir"}`}
                  onClick={() => onOpenCity(page.route.level, s.index, stamped)}
                >
                  <CityStamp
                    city={city}
                    size={72}
                    empty={!stamped}
                    style={stamped ? { translate: `${j.x}px ${j.y}px` } : undefined}
                  />
                  <span className="text-xs text-muted">
                    {s.index}. {s.romaji}
                  </span>
                </button>
              );
            })
          : page.items.map((f) => (
              <span key={f.date} className="flex h-29 flex-col items-center justify-center gap-1 border-r border-b border-hairline px-1" title={f.date}>
                <FortuneStamp kanji={fortuneById(f.fortune as OmikujiFortune).kanji} size={52} />
                <span className="text-xs text-muted">{f.date.slice(5).replace("-", "/")}</span>
              </span>
            ))}
        {filler.map((_, i) => (
          <span key={`f${i}`} className="h-29 border-r border-b border-hairline" aria-hidden="true" />
        ))}
      </div>

      <span className="self-center text-xs text-muted tabular-nums">— {number} —</span>
    </div>
  );
}
