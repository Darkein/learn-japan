// Barre de lecture podcast, fixée en bas de l'écran et persistante (rendue au niveau de
// l'app). Affiche le segment en cours, les contrôles (lecture/pause, précédent/suivant) et
// une tracklist repliable (chapitres Cours / Quiz / Histoire) où l'on peut sauter.

import { useState } from "react";
import type { PodcastSegment } from "../lib/podcast";
import { usePodcastPlayer } from "./usePodcastPlayer";

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
  const [open, setOpen] = useState(false);
  if (!p.active) return null;

  const current = p.segments[p.index];
  const chapter = current ? CHAPTER_LABEL[current.chapter] : "";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 animate-rise border-t border-hairline bg-surface shadow-[0_-4px_20px_rgba(0,0,0,0.18)]">
      <div className="mx-auto max-w-[44rem] px-4 py-3">
        {/* Tracklist repliable */}
        {open && p.segments.length > 0 && (() => {
          // Tracklist compacte : un seul item par label distinct (labels consécutifs identiques fusionnés).
          // Les segments sans label et les doublons consécutifs sont ignorés.
          const tracks: { seg: PodcastSegment; i: number }[] = [];
          for (let i = 0; i < p.segments.length; i++) {
            const seg = p.segments[i];
            if (!seg.label) continue;
            const prev = tracks[tracks.length - 1];
            if (prev && prev.seg.label === seg.label && prev.seg.chapter === seg.chapter) continue;
            tracks.push({ seg, i });
          }
          // Item actif = dernier track dont l'index segment ≤ position courante.
          const activeTrackIdx = tracks.reduce((found, t, ti) => (t.i <= p.index ? ti : found), 0);
          return (
            <ol className="mb-3 max-h-64 list-none overflow-y-auto rounded-sm border border-hairline">
              {tracks.map(({ seg, i }, ti) => {
                const isCurrent = ti === activeTrackIdx;
                const showHeader = ti === 0 || tracks[ti - 1].seg.chapter !== seg.chapter;
                return (
                  <li key={seg.id}>
                    {showHeader && (
                      <div className="bg-surface-2 px-3 py-1 font-sans text-[0.65rem] uppercase tracking-widest text-muted">
                        {CHAPTER_LABEL[seg.chapter]}
                      </div>
                    )}
                    <button
                      className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 aria-[current=true]:text-accent"
                      aria-current={isCurrent}
                      onClick={() => p.jumpTo(i)}
                    >
                      <span className={`shrink-0 font-sans ${isCurrent ? "text-accent" : "text-text"}`}>
                        {isCurrent ? "▸ " : ""}
                        {seg.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          );
        })()}

        <div className="mb-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <span className="truncate font-sans text-sm font-medium text-text">{p.title}</span>
            {p.segments.length > 0 && (
              <span className="ml-2 font-sans text-xs text-muted">
                {Math.max(1, Math.ceil(p.segments.reduce((n, s) => n + s.text.length, 0) / 300))} min
              </span>
            )}
          </div>
          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "▾ Liste" : "▴ Liste"}
          </button>
          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent"
            onClick={p.close}
            aria-label="Fermer le lecteur"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-2 text-sm text-text transition-colors hover:border-accent disabled:opacity-40"
            onClick={p.prev}
            disabled={!!p.preparing}
            aria-label="Segment précédent"
          >
            ⏮
          </button>
          <button
            className="cursor-pointer rounded-sm border border-accent bg-accent px-4 py-2 text-sm text-white transition-colors disabled:opacity-40"
            onClick={p.toggle}
            disabled={!!p.preparing}
            aria-label={p.playing ? "Pause" : "Lecture"}
          >
            {p.playing ? "⏸" : "▶"}
          </button>
          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-2 text-sm text-text transition-colors hover:border-accent disabled:opacity-40"
            onClick={p.next}
            disabled={!!p.preparing}
            aria-label="Segment suivant"
          >
            ⏭
          </button>

          <div className="min-w-0 flex-1 text-xs text-muted">
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
                    <span className={current.lang === "ja" ? "font-jp" : "font-sans"}>{segLabel(current)}</span>
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
