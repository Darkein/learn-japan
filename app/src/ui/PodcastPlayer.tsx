// Barre de lecture podcast, fixée en bas de l'écran et persistante (rendue au niveau de
// l'app). Trois présentations :
//   • réduit  — barre mini (lecture/pause, titre, progression fine) pour dégager la page ;
//   • normal  — titre + segment en cours toujours visibles, contrôles regroupés dessous ;
//   • liste   — tiroir des pistes que l'on tire au doigt (fermé → ouvert → plein écran),
//               avec un fond cliquable qui le referme.
// La hauteur réelle de la barre est mesurée et publiée en variable CSS `--player-h` pour que
// le contenu de page réserve exactement l'espace qu'elle occupe (et pas plus).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeTrackIndex, trackEntries, type PodcastSegment } from "../lib/podcastScript";
import { BOTTOM_NAV_HEIGHT } from "./BottomNav";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { STORY_RATES } from "./useSettings";
import { navigate, useHashRoute } from "./useHashRoute";
import { useMediaQuery } from "./useMediaQuery";
import { Button } from "./kit/Button";
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconInfinity,
  IconLink,
  IconList,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconRepeat,
  IconRepeatOff,
} from "./kit/Icon";

const CHAPTER_LABEL: Record<PodcastSegment["chapter"], string> = {
  cours: "Cours",
  quiz: "Quiz",
  histoire: "Histoire",
  comprehension: "Compréhension",
};

const MODE_LABEL: Record<"auto" | "repeat" | "once", string> = {
  auto: "Lecture auto",
  repeat: "Répétition",
  once: "Jouer une fois",
};

const REDUCED_KEY = "podcast.reduced";
// Hauteur (px) réservée sous la barre du bas quand elle est visible (BOTTOM_NAV_HEIGHT = 3.5rem).
const BOTTOM_NAV_PX = 56;
type SheetState = "closed" | "open" | "full";

/** Libellé de la vitesse courante (« 1× », « 1,25× ») pour le bouton de cycle. */
function rateLabel(rate: number): string {
  return STORY_RATES.find((r) => r.value === rate)?.label ?? `${String(rate).replace(".", ",")}×`;
}

/** Libellé court d'un segment pour la tracklist. */
function segLabel(seg: PodcastSegment): string {
  if (seg.label) return seg.label;
  const t = seg.text.length > 40 ? `${seg.text.slice(0, 40)}…` : seg.text;
  return t || "—";
}

export function PodcastPlayer() {
  const p = usePodcastPlayer();
  const route = useHashRoute();
  const wide = useMediaQuery("(min-width: 60rem)");

  const [reduced, setReduced] = useState<boolean>(
    () => typeof window !== "undefined" && localStorage.getItem(REDUCED_KEY) === "1",
  );
  const [sheet, setSheet] = useState<SheetState>("closed");
  // Hauteur du tiroir pendant un glissement (null = calée sur le point d'ancrage `sheet`).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [vh, setVh] = useState<number>(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [barH, setBarH] = useState(0);

  const barRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false); // scrub de la barre de progression
  const dragFrom = useRef<number | null>(null); // réordonnancement de la file
  const sheetDrag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);

  // Le bottom nav n'apparaît qu'en mobile (pas grand écran) et que sur les 3 onglets
  // principaux (pas sur les sous-pages, qui portent toutes un `from`) — le lecteur se
  // décale d'autant pour ne pas le recouvrir.
  const showBottomNav = !wide && !("from" in route);
  const barBottomPx = showBottomNav ? BOTTOM_NAV_PX : 0;

  // Points d'ancrage du tiroir (px). `full` s'arrête juste au-dessus de la barre pour la
  // garder visible et manœuvrable même déplié.
  const openH = Math.round(vh * 0.5);
  const fullH = Math.max(openH, vh - barH - barBottomPx - 16);
  const snapHeight = (s: SheetState) => (s === "full" ? fullH : s === "open" ? openH : 0);
  const sheetH = dragHeight != null ? dragHeight : snapHeight(sheet);
  const sheetVisible = sheetH > 0;

  // Suit la hauteur de fenêtre (barres d'outils mobiles dynamiques) pour recalculer les ancrages.
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Mesure la hauteur réelle de la barre (varie selon réduit/normal et le contenu).
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => setBarH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.active, reduced]);

  // Publie la hauteur de la barre pour que le contenu de page réserve juste l'espace occupé
  // (corrige le contenu masqué en bas de page). La barre du bas est ajoutée à part par l'App.
  useEffect(() => {
    const root = document.documentElement;
    if (p.active && barH > 0) root.style.setProperty("--player-h", `${barH}px`);
    else root.style.removeProperty("--player-h");
    return () => {
      root.style.removeProperty("--player-h");
    };
  }, [p.active, barH]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(REDUCED_KEY, reduced ? "1" : "0");
  }, [reduced]);

  if (!p.active) return null;

  const current = p.segments[p.index];
  const chapter = current ? CHAPTER_LABEL[current.chapter] : "";
  const durationMin = p.segments.length
    ? Math.max(1, Math.ceil(p.segments.reduce((n, s) => n + s.text.length, 0) / 300))
    : 0;

  // Tracklist compacte (lib/podcastScript.ts) : un item par label distinct.
  const tracks = trackEntries(p.segments);
  const activeTrackIdx = activeTrackIndex(tracks, p.index);
  const progress = p.segments.length ? ((p.index + p.segProgress) / p.segments.length) * 100 : 0;

  function seekAtClientX(clientX: number, rect: DOMRect) {
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    p.seekFraction(frac);
  }

  function nearestSnap(h: number): SheetState {
    const cand: [SheetState, number][] = [
      ["closed", 0],
      ["open", openH],
      ["full", fullH],
    ];
    return cand.reduce((best, c) => (Math.abs(c[1] - h) < Math.abs(snapHeight(best) - h) ? c[0] : best), "closed" as SheetState);
  }

  // Glissement du tiroir : on tire la poignée vers le haut pour ouvrir / plein écran, vers le
  // bas pour refermer. Un simple tap (sans déplacement) bascule ouvert/fermé.
  function onHandleDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDrag.current = { startY: e.clientY, startH: snapHeight(sheet), moved: false };
    setDragHeight(snapHeight(sheet));
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = sheetDrag.current;
    if (!d) return;
    const dy = d.startY - e.clientY;
    if (Math.abs(dy) > 6) d.moved = true;
    setDragHeight(Math.min(fullH, Math.max(0, d.startH + dy)));
  }
  function onHandleUp() {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    if (!d) return;
    if (!d.moved) {
      setSheet((s) => (s === "closed" ? "open" : "closed"));
    } else {
      setSheet(nearestSnap(dragHeight ?? d.startH));
    }
    setDragHeight(null);
  }

  function toggleReduced() {
    setReduced((r) => {
      if (!r) setSheet("closed"); // on replie le tiroir en passant en mode réduit
      return !r;
    });
  }

  const bottom = showBottomNav ? BOTTOM_NAV_HEIGHT : "0px";

  return (
    <>
      {/* Fond cliquable : referme le tiroir quand on interagit avec le site en dessous. */}
      {sheetVisible && !reduced && (
        <div
          className="fixed inset-0 z-40 bg-ink/30"
          aria-hidden="true"
          onPointerDown={() => {
            setSheet("closed");
            setDragHeight(null);
          }}
        />
      )}

      <div className="fixed inset-x-0 z-50 flex animate-rise flex-col" style={{ bottom }}>
        {/* Tiroir des pistes (hauteur animée, tirable). Rendu hors mode réduit. */}
        {!reduced && (
          <div
            className="overflow-hidden border-t border-hairline bg-surface"
            style={{
              height: sheetH,
              transition: dragHeight != null ? "none" : "height 200ms cubic-bezier(0.2,0,0.2,1)",
            }}
          >
            <div className="mx-auto flex h-full max-w-[44rem] flex-col px-4">
              <div className="min-h-0 flex-1 overflow-y-auto py-3">
                {/* File d'attente éditable (pistes) : réordonnancement par glisser-déposer + retrait. */}
                {p.queue.length > 0 && (
                  <ol className="mb-3 list-none rounded-sm border border-hairline">
                    {p.queue.map((item, qi) => {
                      const isCurrent = qi === p.queueIndex;
                      const key = item.kind === "lesson" ? `l-${item.lessonId}-${qi}` : `s-${item.storyId}-${qi}`;
                      return (
                        <li
                          key={key}
                          draggable
                          onDragStart={() => (dragFrom.current = qi)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragFrom.current !== null && dragFrom.current !== qi) p.reorderQueue(dragFrom.current, qi);
                            dragFrom.current = null;
                          }}
                          className={`flex items-center gap-2 border-b border-hairline px-3 py-2 text-sm last:border-b-0 ${isCurrent ? "text-accent" : "text-text"}`}
                        >
                          <span className="cursor-grab select-none text-muted" aria-hidden="true">
                            ⠿
                          </span>
                          <button
                            className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-accent"
                            onClick={() => p.playQueueItem(qi)}
                            title="Lire cette piste"
                          >
                            <span className="mr-1.5 text-xs uppercase tracking-wide text-muted">
                              {item.kind === "lesson" ? "Leçon" : "Histoire"}
                            </span>
                            {item.title}
                          </button>
                          {!isCurrent && (
                            <button
                              className="shrink-0 cursor-pointer text-muted hover:text-accent"
                              aria-label="Retirer de la file"
                              onClick={() => p.removeFromQueue(qi)}
                            >
                              <IconClose size={14} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* Chapitres de la piste courante */}
                {tracks.length > 0 && (
                  <ol className="list-none rounded-sm border border-hairline">
                    {tracks.map(({ seg, i }, ti) => {
                      const isCurrent = ti === activeTrackIdx;
                      const showHeader = ti === 0 || tracks[ti - 1].seg.chapter !== seg.chapter;
                      return (
                        <li key={seg.id}>
                          {showHeader && (
                            <div className="bg-surface-2 px-3 py-1 font-sans text-xs uppercase tracking-widest text-muted">
                              {CHAPTER_LABEL[seg.chapter]}
                            </div>
                          )}
                          <button
                            className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 aria-[current=true]:text-accent"
                            aria-current={isCurrent}
                            onClick={() => p.jumpTo(i)}
                          >
                            <span
                              className={`flex shrink-0 items-center gap-1.5 font-sans ${isCurrent ? "font-medium text-accent" : "text-text"}`}
                            >
                              {isCurrent && <IconPlay size={12} />}
                              {seg.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>
          </div>
        )}

        {/* La barre proprement dite : mode réduit ou normal. */}
        <div
          ref={barRef}
          className="border-t border-hairline bg-surface"
          style={{ paddingBottom: showBottomNav ? undefined : "var(--safe-b)" }}
        >
          {reduced ? (
            <MiniBar p={p} progress={progress} onExpand={toggleReduced} />
          ) : (
            <div className="mx-auto max-w-[44rem] px-4">
              {/* Poignée de glissement : tirer pour ouvrir la liste des pistes / plein écran. */}
              <div
                className="flex touch-none cursor-grab justify-center py-1.5 active:cursor-grabbing"
                onPointerDown={onHandleDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                role="button"
                aria-label={sheet === "closed" ? "Ouvrir la liste des pistes" : "Fermer la liste des pistes"}
                title="Glisser pour ouvrir la liste"
              >
                <span className="h-1 w-9 rounded-full bg-hairline-strong" />
              </div>

              {/* Ligne 1 — titre de la piste (toujours visible) + réduire / fermer. */}
              <div className="flex items-center gap-2">
                <button
                  className="min-w-0 flex-1 cursor-pointer truncate text-left align-baseline font-sans text-sm font-medium text-text hover:text-accent hover:underline"
                  onClick={() => {
                    const pg = p.currentPage();
                    if (pg) navigate(pg);
                  }}
                  title="Ouvrir la page de la piste"
                >
                  {p.title}
                </button>
                <Button
                  size="icon"
                  variant="quiet"
                  onClick={toggleReduced}
                  aria-label="Réduire le lecteur"
                  title="Réduire le lecteur"
                >
                  <IconChevronDown />
                </Button>
                <Button size="icon" variant="quiet" onClick={p.close} aria-label="Fermer le lecteur">
                  <IconClose />
                </Button>
              </div>

              {/* Ligne 2 — segment en cours + méta (durée / position dans le programme). */}
              <div className="mt-0.5 flex items-baseline gap-1.5 text-sm text-muted">
                <span className="min-w-0 flex-1 truncate">
                  {p.preparing ? (
                    p.preparing
                  ) : p.error ? (
                    <span className="text-accent">{p.error}</span>
                  ) : current ? (
                    <>
                      <span className="uppercase tracking-wide">{chapter}</span>
                      {segLabel(current).toLowerCase() !== chapter.toLowerCase() && (
                        <>
                          {" · "}
                          <span className="font-jp">{segLabel(current)}</span>
                        </>
                      )}
                    </>
                  ) : (
                    ""
                  )}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums sm:inline">
                  {durationMin > 0 && `${durationMin} min`}
                  {p.lessonIndex >= 0 && p.lessonTotal > 0 && ` · Leçon ${p.lessonIndex + 1}/${p.lessonTotal}`}
                </span>
              </div>

              {/* Ligne 3 — barre de progression scrubbable. */}
              {p.segments.length > 0 && (
                <div
                  className="mt-2 h-2.5 w-full cursor-pointer touch-none overflow-hidden rounded-full bg-surface-2"
                  onPointerDown={(e) => {
                    draggingRef.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    seekAtClientX(e.clientX, e.currentTarget.getBoundingClientRect());
                  }}
                  onPointerMove={(e) => {
                    if (!draggingRef.current) return;
                    seekAtClientX(e.clientX, e.currentTarget.getBoundingClientRect());
                  }}
                  onPointerUp={() => {
                    draggingRef.current = false;
                  }}
                  onPointerCancel={() => {
                    draggingRef.current = false;
                  }}
                >
                  <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                </div>
              )}

              {/* Ligne 4 — transport à gauche, réglages regroupés à droite. */}
              <div className="mt-2 mb-3 flex items-center gap-2">
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="icon" onClick={p.prev} disabled={!!p.preparing} aria-label="Élément précédent">
                    <IconPrev />
                  </Button>
                  <Button
                    size="icon"
                    variant="primary"
                    onClick={p.toggle}
                    disabled={!!p.preparing}
                    aria-label={p.playing ? "Pause" : "Lecture"}
                  >
                    {p.playing ? <IconPause /> : <IconPlay />}
                  </Button>
                  <Button size="icon" onClick={p.next} disabled={!!p.preparing} aria-label="Élément suivant">
                    <IconNext />
                  </Button>
                </div>

                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    onClick={p.cycleRate}
                    aria-label={`Vitesse de lecture : ${rateLabel(p.rate)}`}
                    title="Vitesse de lecture"
                  >
                    <span className="font-sans text-sm font-medium tabular-nums">{rateLabel(p.rate)}</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={p.cycleMode}
                    aria-label={`Mode : ${MODE_LABEL[p.mode]}`}
                    title={MODE_LABEL[p.mode]}
                  >
                    {p.mode === "auto" ? (
                      <IconInfinity size={20} />
                    ) : p.mode === "repeat" ? (
                      <IconRepeat size={20} />
                    ) : (
                      <IconRepeatOff size={20} />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    active={p.autoNavigate}
                    onClick={p.toggleAutoNavigate}
                    aria-pressed={p.autoNavigate}
                    aria-label={p.autoNavigate ? "Suivi auto activé" : "Suivi auto désactivé"}
                    title="Suivre la lecture : ouvrir la page de la piste courante"
                  >
                    <IconLink size={18} />
                  </Button>
                  <Button
                    size="sm"
                    active={sheet !== "closed"}
                    onClick={() => setSheet((s) => (s === "closed" ? "open" : "closed"))}
                    aria-expanded={sheet !== "closed"}
                    aria-label="Liste des pistes"
                    title="Liste des pistes"
                  >
                    <IconList size={18} />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Barre mini : lecture/pause, titre, progression fine, et bouton pour rétablir la vue complète. */
function MiniBar({
  p,
  progress,
  onExpand,
}: {
  p: ReturnType<typeof usePodcastPlayer>;
  progress: number;
  onExpand: () => void;
}) {
  return (
    <div className="relative">
      {/* Progression collée en haut de la barre mini. */}
      {p.segments.length > 0 && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mx-auto flex max-w-[44rem] items-center gap-2 px-3 py-1.5">
        <Button
          size="icon"
          variant="primary"
          onClick={p.toggle}
          disabled={!!p.preparing}
          aria-label={p.playing ? "Pause" : "Lecture"}
        >
          {p.playing ? <IconPause /> : <IconPlay />}
        </Button>
        <button
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-sans text-sm font-medium text-text hover:text-accent"
          onClick={onExpand}
          title="Agrandir le lecteur"
        >
          {p.title}
        </button>
        <Button size="icon" variant="quiet" onClick={onExpand} aria-label="Agrandir le lecteur" title="Agrandir le lecteur">
          <IconChevronUp />
        </Button>
        <Button size="icon" variant="quiet" onClick={p.close} aria-label="Fermer le lecteur">
          <IconClose />
        </Button>
      </div>
    </div>
  );
}
