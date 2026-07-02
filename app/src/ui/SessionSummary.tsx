import { useEffect, useState } from "react";
import { getComprehensionItem, getGrammar, getVocab } from "../lib/db";
import type { Exercise } from "../lib/exercise";
import { isMastered, isUnlockReady, type SrsGrade } from "../lib/srs";
import { SRS } from "../lib/config";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

interface SummaryEntry {
  card: Exercise;
  grade: SrsGrade;
  mastered: boolean;
  /** Assez stable pour compter dans le déblocage de la leçon suivante (seuil léger, voir SRS.unlockIntervalDays). */
  unlockReady: boolean;
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
          fsrsCard = item?.cards?.[r.card.skill ?? "written"];
        } else if (r.card.track === "grammar") {
          const item = await getGrammar(r.card.id);
          fsrsCard = item?.card;
        } else {
          const item = await getComprehensionItem(r.card.id);
          fsrsCard = item?.card;
        }
        // La piste compréhension ne compte pas dans le déblocage des leçons (voir
        // computeUnlockProgress) : le badge n'a de sens que pour vocab/grammaire.
        const countsForUnlock = r.card.track === "vocab" || r.card.track === "grammar";
        entries.push({
          card: r.card,
          grade: r.grade,
          mastered: fsrsCard ? isMastered(fsrsCard) : false,
          unlockReady: countsForUnlock && fsrsCard ? isUnlockReady(fsrsCard) : false,
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
    <Card className="flex flex-col gap-4 py-6">
      <div>
        <SectionLabel>Bilan</SectionLabel>
        <p className="font-serif text-lg text-text">
          {title} — {results.length} élément{results.length > 1 ? "s" : ""} revu
          {results.length > 1 ? "s" : ""}
        </p>
      </div>

      {leeches.length > 0 && (
        <div className="flex flex-col gap-1">
          <SectionLabel>Éléments difficiles</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {leeches.map((r) => (
              <Badge key={r.card.key} className="font-jp">
                {r.card.front}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Éléments revus</SectionLabel>
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
                      {entry.card.isLeech && <Badge>difficile</Badge>}
                      {entry.mastered ? (
                        <Badge variant="accent">maîtrisé</Badge>
                      ) : entry.unlockReady ? (
                        <Badge variant="accent">débloquant</Badge>
                      ) : entry.intervalDays === 0 ? (
                        <Badge>nouveau</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-hairline">
                    {/* Repère du seuil de déblocage (léger, bien avant la maîtrise à 21 j). */}
                    <div
                      className="absolute inset-y-0 w-px bg-text/30"
                      style={{ left: `${Math.round((SRS.unlockIntervalDays / SRS.masteredIntervalDays) * 100)}%` }}
                    />
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
          <Button variant="primary" onClick={onRestart}>
            Recommencer
          </Button>
        )}
        {onReplayMissed && (
          <Button
            variant="ghost"
            disabled={missed.length === 0}
            onClick={() => onReplayMissed(missed.map((r) => r.card))}
          >
            Rejouer les ratés {missed.length > 0 ? `(${missed.length})` : ""}
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            Retour
          </Button>
        )}
      </div>
    </Card>
  );
}
