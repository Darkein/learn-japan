import type { MirrorDelta as Delta } from "../lib/mirror";
import { formatDaysAgo } from "../lib/time";
import { Badge } from "./kit/Badge";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

interface Props {
  delta: Delta;
  storyCreatedAt: number;
}

/**
 * Présentation factuelle du delta de relecture : deux jauges superposées (à l'époque en
 * accent estompé, aujourd'hui en accent — même pattern que SessionSummary) et un
 * échantillon des mots appris depuis. Pas d'exclamation, les chiffres suffisent.
 */
export function MirrorDeltaView({ delta, storyCreatedAt }: Props) {
  const { totalWords, knownThen, knownNow, newSince } = delta;
  if (totalWords === 0) return null;
  const thenPct = Math.round((knownThen / totalWords) * 100);
  const nowPct = Math.round((knownNow / totalWords) * 100);
  return (
    <Card className="flex flex-col gap-3 py-4">
      <SectionLabel>Relecture-miroir</SectionLabel>
      <p className="m-0 text-sm leading-relaxed text-text">
        Quand cette histoire a été écrite ({formatDaysAgo(storyCreatedAt)}), tu avais déjà
        croisé <strong>{knownThen}</strong> de ses <strong>{totalWords}</strong> mots.
        Aujourd'hui, tu en suis <strong>{knownNow}</strong>.
      </p>
      {/* Jauge « aujourd'hui » avec le repère « à l'époque » (pattern SessionSummary). */}
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-hairline">
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-accent"
          style={{ width: `${nowPct}%` }}
        />
        <div className="absolute inset-y-0 w-px bg-text/40" style={{ left: `${thenPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>à l'époque : {thenPct} %</span>
        <span>aujourd'hui : {nowPct} %</span>
      </div>
      {newSince.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Appris depuis</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {newSince.map((w) => (
              <Badge key={w} className="font-jp">
                {w}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
