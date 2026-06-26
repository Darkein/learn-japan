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
        {open && p.segments.length > 0 && (
          <ol className="mb-3 max-h-64 list-none overflow-y-auto rounded-sm border border-hairline">
            {p.segments.map((seg, i) => {
              const isCurrent = i === p.index;
              const showHeader = i === 0 || p.segments[i - 1].chapter !== seg.chapter;
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
                    <span className={`shrink-0 ${seg.lang === "ja" ? "font-jp" : "font-sans"} ${isCurrent ? "text-accent" : "text-text"}`}>
                      {isCurrent ? "▸ " : ""}
                      {segLabel(seg)}
                    </span>
                    {seg.pauseAfterMs ? <span className="text-xs text-muted">· réponds…</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        )}

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

          <div className="min-w-0 flex-1">
            <div className="truncate font-sans text-sm text-text">{p.title}</div>
            <div className="truncate text-xs text-muted">
              {p.preparing ? (
                p.preparing
              ) : p.error ? (
                <span className="text-accent">{p.error}</span>
              ) : current ? (
                <>
                  <span className="uppercase tracking-wide">{chapter}</span>
                  {" · "}
                  <span className={current.lang === "ja" ? "font-jp" : "font-sans"}>{segLabel(current)}</span>
                </>
              ) : (
                ""
              )}
            </div>
          </div>

          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:border-accent"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? "▾ Liste" : "▴ Liste"}
          </button>
          <button
            className="cursor-pointer rounded-sm border border-hairline px-3 py-2 text-xs text-muted transition-colors hover:border-accent"
            onClick={p.close}
            aria-label="Fermer le lecteur"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
