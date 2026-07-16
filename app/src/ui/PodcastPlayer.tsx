// Barre de lecture podcast, fixée en bas de l'écran et persistante (rendue au niveau de
// l'app). Affiche le segment en cours, les contrôles (lecture/pause, précédent/suivant) et
// une tracklist repliable (chapitres Cours / Quiz / Histoire) où l'on peut sauter.

import { useRef, useState } from "react";
import { activeTrackIndex, trackEntries, type PodcastSegment } from "../lib/podcastScript";
import { BOTTOM_NAV_HEIGHT } from "./BottomNav";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { navigate, useHashRoute } from "./useHashRoute";
import { useMediaQuery } from "./useMediaQuery";
import { Button } from "./kit/Button";
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconInfinity,
  IconLink,
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
  const [open, setOpen] = useState(false);
  const draggingRef = useRef(false);
  const dragFrom = useRef<number | null>(null);
  if (!p.active) return null;

  // Le bottom nav n'apparaît qu'en mobile (pas grand écran) et que sur les 3 onglets
  // principaux (pas sur les sous-pages, qui portent toutes un `from`) — le lecteur se
  // décale d'autant pour ne pas le recouvrir.
  const showBottomNav = !wide && !("from" in route);

  const current = p.segments[p.index];
  const chapter = current ? CHAPTER_LABEL[current.chapter] : "";

  // Tracklist compacte (lib/podcastScript.ts) : un item par label distinct. La navigation
  // précédent/suivant à cette granularité vit dans le hook (p.next/p.prev), partagée avec
  // les commandes média OS ; ici on ne s'en sert que pour la liste dépliable.
  const tracks = trackEntries(p.segments);
  const activeTrackIdx = activeTrackIndex(tracks, p.index);

  function seekAtClientX(clientX: number, rect: DOMRect) {
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    p.seekFraction(frac);
  }

  return (
    <div
      className="fixed inset-x-0 z-50 animate-rise border-t border-hairline bg-surface"
      style={{ bottom: showBottomNav ? BOTTOM_NAV_HEIGHT : "0px" }}
    >
      <div
        className="mx-auto max-w-[44rem] px-4 py-3"
        style={{ paddingBottom: showBottomNav ? undefined : "calc(var(--safe-b) + 0.75rem)" }}
      >
        {/* File d'attente éditable (pistes) : réordonnancement par glisser-déposer + retrait. */}
        {open && p.queue.length > 0 && (
          <ol className="mb-3 max-h-48 list-none overflow-y-auto rounded-sm border border-hairline">
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

        {/* Tracklist repliable (chapitres de la piste courante) */}
        {open && tracks.length > 0 && (
          <ol className="mb-3 max-h-64 list-none overflow-y-auto rounded-sm border border-hairline">
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

        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <button
              className="max-w-full cursor-pointer truncate align-baseline font-sans text-sm font-medium text-text hover:text-accent hover:underline"
              onClick={() => {
                const pg = p.currentPage();
                if (pg) navigate(pg);
              }}
              title="Ouvrir la page de la piste"
            >
              {p.title}
            </button>
            {p.segments.length > 0 && (
              <span className="ml-2 font-sans text-xs text-muted">
                {Math.max(1, Math.ceil(p.segments.reduce((n, s) => n + s.text.length, 0) / 300))} min
              </span>
            )}
            {p.lessonIndex >= 0 && p.lessonTotal > 0 && (
              <span className="ml-2 font-sans text-xs text-muted">
                · Leçon {p.lessonIndex + 1}/{p.lessonTotal}
              </span>
            )}
          </div>
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
            onClick={p.cycleMode}
            aria-label={`Mode : ${MODE_LABEL[p.mode]}`}
            title={MODE_LABEL[p.mode]}
          >
            {p.mode === "auto" ? (
              <IconInfinity size={22} />
            ) : p.mode === "repeat" ? (
              <IconRepeat size={22} />
            ) : (
              <IconRepeatOff size={22} />
            )}
          </Button>
          <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Liste
            {open ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </Button>
          <Button size="icon" variant="quiet" onClick={p.close} aria-label="Fermer le lecteur">
            <IconClose />
          </Button>
        </div>

        {p.segments.length > 0 && (
          <div
            className="mb-2 h-2.5 w-full cursor-pointer touch-none overflow-hidden rounded-full bg-surface-2"
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
            <div
              className="h-full bg-accent"
              style={{ width: `${((p.index + p.segProgress) / p.segments.length) * 100}%` }}
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex shrink-0 items-center gap-3">
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

          <div className="min-w-0 basis-full text-sm text-muted sm:basis-auto sm:flex-1">
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
          </div>
        </div>
      </div>
    </div>
  );
}
