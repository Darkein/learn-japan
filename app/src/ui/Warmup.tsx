import { useEffect, useState } from "react";
import { daysBeforeGrade, TRACK_FR, type Exercise } from "../lib/exercise";
import type { SrsGrade } from "../lib/srs";
import { buildSession, gradeCard, type SessionOpts } from "../lib/warmup";
import { ExerciseCard } from "./ExerciseCard";
import { SessionSummary } from "./SessionSummary";
import { useSettings } from "./useSettings";

interface Props {
  opts?: SessionOpts;
  onExit?: () => void;
}

export function Warmup({ opts, onExit }: Props) {
  const { settings, update } = useSettings();
  const [cards, setCards] = useState<Exercise[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ card: Exercise; grade: SrsGrade; daysBefore: number }[]>([]);

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  if (!cards) return <p className="text-muted">Chargement…</p>;
  if (cards.length === 0)
    return (
      <p className="text-muted">
        Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici.
      </p>
    );
  if (i >= cards.length || !card) {
    function restart(deck?: Exercise[]) {
      setResults([]);
      setI(0);
      if (deck) {
        setCards(deck);
      } else {
        setCards(null);
        void buildSession(new Date(), opts ?? {}).then(setCards);
      }
    }

    return (
      <SessionSummary
        results={results}
        title="Échauffement terminé"
        onRestart={() => restart()}
        onReplayMissed={(missed) => restart(missed)}
        onClose={onExit}
      />
    );
  }

  function nextCard() {
    setI((n) => n + 1);
  }

  async function persistGrade(g: SrsGrade) {
    const graded = card!;
    const daysBefore = await daysBeforeGrade(graded);
    await gradeCard(graded, g);
    setResults((r) => [...r, { card: graded, grade: g, daysBefore }]);
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs uppercase tracking-wider text-muted">
        Échauffement {i + 1} / {cards.length} ·{" "}
        <span className="text-accent-2">{TRACK_FR[card.track]}</span>
      </span>
      <ExerciseCard
        key={card.key}
        exercise={card}
        onGraded={(g) => void persistGrade(g)}
        onNext={nextCard}
        romaji={settings.warmupRomaji}
        onRomajiChange={(v) => update({ warmupRomaji: v })}
      />
    </div>
  );
}
