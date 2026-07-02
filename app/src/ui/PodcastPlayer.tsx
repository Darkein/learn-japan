// Barre de lecture podcast, fixée en bas de l'écran et persistante (rendue au niveau de
// l'app). Affiche le segment en cours, les contrôles (lecture/pause, précédent/suivant) et
// une tracklist repliable (chapitres Cours / Quiz / Histoire) où l'on peut sauter.

import { useRef, useState } from "react";
import type { PodcastSegment } from "../lib/podcast";
import { BOTTOM_NAV_HEIGHT } from "./BottomNav";
import { usePodcastPlayer } from "./usePodcastPlayer";
import { useHashRoute } from "./useHashRoute";
import { useMediaQuery } from "./useMediaQuery";
import { Button } from "./kit/Button";
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
} from "./kit/Icon";

const CHAPTER_LABEL: Record<PodcastSegment["chapter"], string> = {
  cours: "Cours",
  quiz: "Quiz",
  histoire: "Histoire",
  comprehension: "Compréhension",
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
  if (!p.active) return null;

  // Le bottom nav n'apparaît qu'en mobile (pas grand écran) et que sur les 3 onglets
  // principaux (pas sur les sous-pages, qui portent toutes un `from`) — le lecteur se
  // décale d'autant pour ne pas le recouvrir.
  const showBottomNav = !wide && !("from" in route);

  const current = p.segments[p.index];
  const chapter = current ? CHAPTER_LABEL[current.chapter] : "";

  // Tracklist compacte : un seul item par label distinct (labels consécutifs identiques fusionnés).
  // Les segments sans label et les doublons consécutifs sont ignorés. Sert à la fois à la liste
  // dépliable et à la navigation précédent/suivant (par élément, pas par segment brut).
  const tracks: { seg: PodcastSegment; i: number }[] = [];
  for (let i = 0; i < p.segments.length; i++) {
    const seg = p.segments[i];
    if (!seg.label) continue;
    const prevTrack = tracks[tracks.length - 1];
    if (prevTrack && prevTrack.seg.label === seg.label && prevTrack.seg.chapter === seg.chapter) continue;
    tracks.push({ seg, i });
  }
  // Item actif = dernier track dont l'index segment ≤ position courante.
  const activeTrackIdx = tracks.length ? tracks.reduce((found, t, ti) => (t.i <= p.index ? ti : found), 0) : -1;

  function goToTrack(delta: 1 | -1) {
    if (!tracks.length) {
      delta > 0 ? p.next() : p.prev();
      return;
    }
    const targetTi = Math.min(tracks.length - 1, Math.max(0, activeTrackIdx + delta));
    p.jumpTo(tracks[targetTi].i);
  }

  function seekAtClientX(clientX: number, rect: DOMRect) {
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    p.jumpTo(Math.min(p.segments.length - 1, Math.floor(frac * p.segments.length)));
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
        {/* Tracklist repliable */}
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
            <span className="truncate font-sans text-sm font-medium text-text">{p.title}</span>
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
            <Button
              size="icon"
              onClick={() => goToTrack(-1)}
              disabled={!!p.preparing}
              aria-label="Élément précédent"
            >
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
            <Button
              size="icon"
              onClick={() => goToTrack(1)}
              disabled={!!p.preparing}
              aria-label="Élément suivant"
            >
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
