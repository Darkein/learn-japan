import { useEffect, useState } from "react";
import { daysBeforeGrade, TRACK_FR, type Exercise } from "../lib/exercise";
import { STEP_LABEL } from "../lib/path";
import type { SrsGrade } from "../lib/srs";
import { buildSession, gradeCard, silenceDeck, type SessionOpts } from "../lib/reviewSession";
import { ExerciseCard } from "./exercise/ExerciseCard";
import { SessionSummary } from "./SessionSummary";
import { PRACTICE_HINT, PRACTICE_SUMMARY, REPLAY_HINT, REPLAY_SUMMARY } from "./practiceNotes";
import { Button } from "./kit/Button";
import { LoadingScreen } from "./kit/LoadingScreen";
import { useSettings } from "./useSettings";

interface Props {
  opts?: SessionOpts;
  onExit?: () => void;
  /** Libellé de la sortie du bilan (le parcours : « Continuer »), cf. SessionSummary. */
  exitLabel?: string;
}

export function ReviewSession({ opts, onExit, exitLabel }: Props) {
  const { settings, update } = useSettings();
  // Un nom par entrée : l'étape du parcours (« Vocabulaire », « Produire »…), « Révision »
  // (étape Révision, scope "due") ou « Question » (entraînement libre, scope "all").
  const scope = opts?.scope ?? "due";
  const checkup = scope === "all";
  const sessionName =
    scope === "step" && opts?.step ? STEP_LABEL[opts.step] : checkup ? "Question" : "Révision";
  // Relance des ratés : ces cartes viennent d'être notées dans CETTE session — la première
  // réponse compte, et elle seule (SPEC §5.5). Les noter une seconde fois comptait deux fois
  // le même oubli ; effacer l'erreur sur une réussite à quelques secondes de la correction
  // ferait d'une mémoire immédiate une maîtrise. La relance est donc un entraînement.
  const [replaying, setReplaying] = useState(false);
  // Entraînement = aucune écriture SRS : ni la carte, ni le journal, ni le compteur du jour.
  // Le bilan de leçon (scope "all") en fait toujours partie — il se lance à volonté, hors
  // planification ; ni une erreur ne doit faire baisser la maîtrise, ni une réussite
  // répétée la gonfler.
  const practice = checkup || replaying;
  const [cards, setCards] = useState<Exercise[] | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ card: Exercise; grade: SrsGrade; daysBefore: number }[]>([]);

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  if (!cards) return <LoadingScreen />;
  if (cards.length === 0)
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-muted">
          {scope === "step"
            ? "Rien à travailler ici : les éléments de cette étape sont déjà acquis."
            : checkup
              ? "Aucun exercice disponible pour cette leçon."
              : "Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici."}
        </p>
        {/* Dans le parcours, une étape vide se valide d'un geste : jamais de cul-de-sac. */}
        {onExit && (
          <Button variant="primary" className="self-start" onClick={onExit}>
            Continuer
          </Button>
        )}
      </div>
    );
  if (i >= cards.length || !card) {
    function restart(deck?: Exercise[]) {
      setResults([]);
      setI(0);
      setReplaying(!!deck);
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
        title={checkup ? "Acquis vérifiés" : scope === "step" ? "Étape terminée" : "Révision terminée"}
        note={checkup ? PRACTICE_SUMMARY : replaying ? REPLAY_SUMMARY : undefined}
        onRestart={() => restart()}
        onReplayMissed={(missed) => restart(missed)}
        onClose={onExit}
        closeLabel={exitLabel}
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
    if (!practice) await gradeCard(graded, g);
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
      {practice && (
        <p className="m-0 text-xs text-muted">{checkup ? PRACTICE_HINT : REPLAY_HINT}</p>
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
