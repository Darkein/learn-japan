import { useEffect, useState } from "react";
import { getComprehensionItem, getGrammar, getVocab } from "../lib/db";
import type { Exercise } from "../lib/exercise";
import { isMastered, type SrsGrade } from "../lib/srs";
import { SRS } from "../lib/config";

interface SummaryEntry {
  card: Exercise;
  grade: SrsGrade;
  mastered: boolean;
  intervalDaysBefore: number;
  intervalDays: number;
}

interface ResultEntry {
  card: Exercise;
  grade: SrsGrade;
  daysBefore: number;
}

interface Props {
  results: ResultEntry[];
  title: string;
  onClose?: () => void;
  onRestart?: () => void;
  onReplayMissed?: (missed: Exercise[]) => void;
}

/** Bilan de fin de session (Échauffement, Exercices du lecteur) : score, maîtrise, relances. */
export function SessionSummary({ results, title, onClose, onRestart, onReplayMissed }: Props) {
  const [summary, setSummary] = useState<SummaryEntry[] | null>(null);

  useEffect(() => {
    setSummary(null);
    async function loadSummary() {
      const entries: SummaryEntry[] = [];
      for (const r of results) {
        let fsrsCard: import("ts-fsrs").Card | undefined;
        if (r.card.track === "vocab") {
          const item = await getVocab(r.card.id);
          fsrsCard = item?.cards?.written;
        } else if (r.card.track === "grammar") {
          const item = await getGrammar(r.card.id);
          fsrsCard = item?.card;
        } else {
          const item = await getComprehensionItem(r.card.id);
          fsrsCard = item?.card;
        }
        entries.push({
          card: r.card,
          grade: r.grade,
          mastered: fsrsCard ? isMastered(fsrsCard) : false,
          intervalDaysBefore: r.daysBefore,
          intervalDays: fsrsCard?.scheduled_days ?? 0,
        });
      }
      setSummary(entries);
    }
    void loadSummary();
  }, [results]);

  const missed = results.filter((r) => r.grade === "again" || r.grade === "hard");
  const leeches = results.filter((r) => r.card.isLeech);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6">
      <div>
        <span className="text-xs uppercase tracking-widest text-muted">Bilan</span>
        <p className="font-serif text-lg text-text">
          {title} — {results.length} élément{results.length > 1 ? "s" : ""} revu
          {results.length > 1 ? "s" : ""}
        </p>
      </div>

      {leeches.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-widest text-muted">Éléments difficiles</span>
          <div className="flex flex-wrap gap-2">
            {leeches.map((r) => (
              <span
                key={r.card.key}
                className="rounded-sm border border-hairline px-2 py-0.5 text-xs text-muted font-jp"
              >
                {r.card.front}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-widest text-muted">Éléments revus</span>
        {summary === null ? (
          <p className="text-sm text-muted">Calcul de la maîtrise…</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.map((entry) => {
              const beforePct = Math.min(
                100,
                Math.round((entry.intervalDaysBefore / SRS.masteredIntervalDays) * 100),
              );
              const afterPct = Math.min(
                100,
                Math.round((entry.intervalDays / SRS.masteredIntervalDays) * 100),
              );
              return (
                <li key={entry.card.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-jp text-sm text-text">{entry.card.front}</span>
                    <div className="flex items-center gap-1.5">
                      {entry.card.isLeech && (
                        <span className="rounded-sm border border-hairline px-1.5 py-0.5 text-xs text-muted">
                          difficile
                        </span>
                      )}
                      {entry.mastered ? (
                        <span className="rounded-sm border border-accent px-1.5 py-0.5 text-xs text-accent">
                          maîtrisé
                        </span>
                      ) : entry.intervalDays === 0 ? (
                        <span className="rounded-sm border border-hairline px-1.5 py-0.5 text-xs text-muted">
                          nouveau
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-hairline">
                    <div
                      className="absolute inset-y-0 left-0 rounded-l-full bg-accent/30 transition-all"
                      style={{ width: `${beforePct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 rounded-l-full bg-accent transition-all"
                      style={{ width: `${afterPct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {onRestart && (
          <button
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm text-white"
            onClick={onRestart}
          >
            Recommencer
          </button>
        )}
        {onReplayMissed && (
          <button
            className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={missed.length === 0}
            onClick={() => onReplayMissed(missed.map((r) => r.card))}
          >
            Rejouer les ratés {missed.length > 0 ? `(${missed.length})` : ""}
          </button>
        )}
        {onClose && (
          <button
            className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent"
            onClick={onClose}
          >
            Retour
          </button>
        )}
      </div>
    </div>
  );
}
