import { useEffect, useState } from "react";
import { SRS } from "../lib/config";
import { daysBeforeGrade, TRACK_FR, type Exercise } from "../lib/exercise";
import type { SrsGrade } from "../lib/srs";
import { buildSession, gradeCard, sessionStats, silenceDeck, type SessionOpts } from "../lib/reviewSession";
import { ExerciseCard } from "./exercise/ExerciseCard";
import { SessionSummary } from "./SessionSummary";
import { LoadingScreen } from "./kit/LoadingScreen";
import { useSettings } from "./useSettings";

interface Props {
  opts?: SessionOpts;
  onExit?: () => void;
}

export function ReviewSession({ opts, onExit }: Props) {
  const { settings, update } = useSettings();
  // Deux modes, deux noms : "Révision" (SRS du jour, scope "due") et
  // "Vérification des acquis" (toute la leçon, scope "all") — cohérent avec le bouton d'entrée.
  const checkup = (opts?.scope ?? "due") === "all";
  const sessionName = checkup ? "Question" : "Révision";
  const [cards, setCards] = useState<Exercise[] | null>(null);
  const [i, setI] = useState(0);
  const [backlog, setBacklog] = useState(0);
  const [results, setResults] = useState<{ card: Exercise; grade: SrsGrade; daysBefore: number }[]>([]);

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
    // Session plafonnée : indique combien d'éléments urgents attendront la suivante.
    if ((opts?.scope ?? "due") === "due") {
      void sessionStats().then((stats) =>
        setBacklog(Math.max(0, stats.dueCount - SRS.sessionCap)),
      );
    }
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  if (!cards) return <LoadingScreen />;
  if (cards.length === 0)
    return (
      <p className="text-muted">
        {checkup
          ? "Aucun exercice disponible pour cette leçon."
          : "Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici."}
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
        title={checkup ? "Acquis vérifiés" : "Révision terminée"}
        onRestart={() => restart()}
        onReplayMissed={(missed) => restart(missed)}
        onClose={onExit}
      />
    );
  }

  function nextCard() {
    setI((n) => n + 1);
  }

  /**
   * « Je ne peux pas écouter » (la pause est déjà posée par la carte) : les exercices
   * d'écoute qui RESTENT, celui-ci compris, deviennent leur équivalent écrit — inutile
   * d'attendre la session suivante pour que la pause serve à quelque chose.
   */
  async function silenceRest() {
    const deck = cards!;
    const rest = await silenceDeck(deck.slice(i));
    setCards([...deck.slice(0, i), ...rest]);
  }

  async function persistGrade(g: SrsGrade) {
    const graded = card!;
    const daysBefore = await daysBeforeGrade(graded);
    await gradeCard(graded, g);
    setResults((r) => [...r, { card: graded, grade: g, daysBefore }]);
  }

  // Pause d'écoute en cours : minutes restantes (0 = pas de pause).
  const silentMinutes = Math.max(0, Math.ceil((settings.silentUntil - Date.now()) / 60000));

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs uppercase tracking-wider text-muted">
        {sessionName} {i + 1} / {cards.length} ·{" "}
        <span className="text-accent-2">{TRACK_FR[card.track]}</span>
      </span>
      {backlog > 0 && (
        <p className="m-0 text-xs text-muted">
          Session plafonnée aux {SRS.sessionCap} éléments les plus urgents — {backlog} autre
          {backlog > 1 ? "s" : ""} attendront la prochaine.
        </p>
      )}
      {silentMinutes > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-muted">
          Écoute en pause encore {silentMinutes} min — les exercices d'écoute passent à l'écrit.
          <button
            className="cursor-pointer text-xs text-muted underline"
            onClick={() => update({ silentUntil: 0 })}
          >
            Réactiver le son
          </button>
        </p>
      )}
      <ExerciseCard
        key={card.key}
        exercise={card}
        onGraded={(g) => void persistGrade(g)}
        onNext={nextCard}
        onSilence={() => void silenceRest()}
        romaji={settings.warmupRomaji}
        onRomajiChange={(v) => update({ warmupRomaji: v })}
      />
    </div>
  );
}
