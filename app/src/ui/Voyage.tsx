import { useEffect, useState } from "react";
import { TOKAIDO } from "../data/tokaido";
import { allLessonProgress } from "../lib/db";
import { listLessons } from "../lib/lessons";
import {
  estimateLessonsToNext,
  tokaidoStatus,
  type TokaidoStatus,
} from "../lib/tokaido";
import { formatDaysAgo } from "../lib/time";
import { ProgressBar } from "./kit/ProgressBar";
import { SectionLabel } from "./kit/SectionLabel";

/** Torii minimal (3 traits, --ink) marquant l'arrivée à Kyōto. */
function Torii({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
      <g stroke="var(--ink)" strokeWidth="1.5" fill="none">
        <path d="M1 3 Q10 1 19 3" />
        <line x1="3" y1="6" x2="17" y2="6" />
        <line x1="5" y1="4" x2="5.6" y2="15" />
        <line x1="15" y1="4" x2="14.4" y2="15" />
      </g>
    </svg>
  );
}

/**
 * Vue dédiée du voyage : la route verticale d'Edo (en haut) à Kyōto (en bas), toutes les
 * stations, la position courante en accent. Mobile-first : on scrolle le long de la route.
 */
export function Voyage() {
  const [status, setStatus] = useState<TokaidoStatus | null>(null);
  const [departedAt, setDepartedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const lessons = await listLessons();
      setStatus(await tokaidoStatus(lessons));
      const progress = await allLessonProgress();
      const starts = progress.map((p) => p.startedAt).filter((t): t is number => !!t);
      setDepartedAt(starts.length ? Math.min(...starts) : null);
    })();
  }, []);

  if (!status) return <p className="text-muted">Chargement…</p>;

  const { pos, levels } = status;
  const lessonsToNext = estimateLessonsToNext(pos, levels);
  const currentIndex = pos.station.index;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionLabel>Ton chemin</SectionLabel>
        <p className="font-serif text-lg">
          {currentIndex === 0 ? (
            <>Tu es à Nihonbashi, prêt à partir.</>
          ) : pos.next ? (
            <>
              {currentIndex} station{currentIndex > 1 ? "s" : ""} sur {TOKAIDO.length - 1} — tu es à{" "}
              <span className="font-jp">{pos.station.kanji}</span> {pos.station.romaji}.
            </>
          ) : (
            <>Tu as atteint Kyōto — les {TOKAIDO.length - 1} étapes de la route sont derrière toi.</>
          )}
        </p>
        {departedAt && (
          <p className="text-sm text-muted">Parti de Nihonbashi {formatDaysAgo(departedAt)}.</p>
        )}
        <ProgressBar value={(pos.position / (TOKAIDO.length - 1)) * 100} />
        {pos.next && (
          <p className="text-sm text-muted">
            Prochaine étape : <span className="font-jp text-text">{pos.next.kanji}</span>{" "}
            {pos.next.romaji} — {pos.betweenPct} % du chemin
            {lessonsToNext != null && (
              <>, encore ~{lessonsToNext} leçon{lessonsToNext > 1 ? "s" : ""}</>
            )}
            .
          </p>
        )}
      </section>

      <section>
        <SectionLabel as="h3" className="mb-4 block">
          La route — Edo → Kyōto
        </SectionLabel>
        <ol className="flex flex-col">
          {TOKAIDO.map((s) => {
            const passed = s.index < currentIndex || (!pos.next && s.index === currentIndex);
            const current = s.index === currentIndex && !!pos.next;
            return (
              <li key={s.index} className="relative flex gap-4 pl-1">
                {/* Rail : trait vertical continu + point de station. */}
                <div className="flex w-4 flex-col items-center" aria-hidden="true">
                  {s.index > 0 && (
                    <span
                      className="w-px flex-none"
                      style={{ height: "0.55rem", background: passed || current ? "var(--ink)" : "var(--hairline)" }}
                    />
                  )}
                  <span
                    className={`h-2 w-2 flex-none rounded-full ${current ? "bg-accent" : ""}`}
                    style={
                      current
                        ? undefined
                        : passed
                          ? { background: "var(--ink)" }
                          : { border: "1px solid var(--hairline-strong)" }
                    }
                  />
                  {s.index < TOKAIDO.length - 1 && (
                    <span
                      className="w-px flex-1"
                      style={{
                        // Segment courant : encré à hauteur de la progression vers la prochaine station.
                        background:
                          s.index < currentIndex
                            ? "var(--ink)"
                            : current && pos.betweenPct > 0
                              ? `linear-gradient(to bottom, var(--ink) ${pos.betweenPct}%, var(--hairline) ${pos.betweenPct}%)`
                              : "var(--hairline)",
                      }}
                    />
                  )}
                </div>
                <div className={`flex items-baseline gap-3 pb-5 ${current ? "" : "min-h-0"}`}>
                  <span
                    className={`font-jp ${
                      current ? "text-2xl text-text" : passed ? "text-base text-text" : "text-base text-muted"
                    }`}
                  >
                    {s.kanji}
                  </span>
                  <span className={`text-xs ${current ? "text-text" : "text-muted"}`}>
                    {s.romaji}
                  </span>
                  {s.index === TOKAIDO.length - 1 && <Torii className="self-center" />}
                  {current && <span className="text-xs text-accent">Tu es ici</span>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
