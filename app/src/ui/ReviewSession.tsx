import { useEffect, useRef, useState } from "react";
import { daysBeforeGrade, isMiss, recordLevel, TRACK_FR, type Exercise } from "../lib/exercise";
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
  /**
   * Étape du parcours (SPEC §5.5) : les ratés sont REJOUÉS d'office à la fin, jusqu'à être
   * tous réussis — pas de cœurs, pas d'étape « ratée ». La relance n'écrit rien dans le SRS
   * (la première réponse a compté) ; le bilan est celui du premier passage.
   */
  autoReplay?: boolean;
}

type Result = { card: Exercise; grade: SrsGrade; daysBefore: number };

export function ReviewSession({ opts, onExit, exitLabel, autoReplay }: Props) {
  const { settings, update } = useSettings();
  // Un nom par entrée : l'étape du parcours (« Vocabulaire », « Produire »…), « Révision »
  // (étape Révision, scope "due") ou « Question » (entraînement libre, scope "all").
  const scope = opts?.scope ?? "due";
  const checkup = scope === "all";
  const baseName =
    scope === "step" && opts?.step
      ? STEP_LABEL[opts.step]
      : scope === "rest"
        ? "Station de repos"
        : checkup
          ? "Question"
          : "Révision";
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
  const [results, setResults] = useState<Result[]>([]);
  // Bilan d'une étape à relances automatiques : le PREMIER passage, celui qui a compté.
  const [firstPass, setFirstPass] = useState<Result[] | null>(null);
  // Tour de relance (0 = premier passage) : entre dans la clé de rendu de l'exercice, qu'un
  // raté rejoué juste après lui-même se remonte à neuf.
  const [round, setRound] = useState(0);
  const sessionName = replaying && autoReplay ? "Relance des ratés" : baseName;

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  // Durée de réponse (SPEC §5.7) : depuis l'apparition de l'exercice jusqu'à sa note.
  const shownAt = useRef(Date.now());
  useEffect(() => {
    shownAt.current = Date.now();
  }, [round, i]);

  // Fin d'un tour d'une étape : s'il reste des ratés, on les rejoue d'office. Le tour n'est
  // fini qu'une fois TOUS ses résultats arrivés : « Continuer » passe à la suite aussitôt,
  // mais la note du dernier exercice s'écrit en base avant d'entrer dans `results`. Décider
  // sur le seul index, c'était chercher les ratés sans le dernier — raté, il n'était jamais
  // rejoué et l'écran attendait une relance qui ne venait pas.
  const grading = !!cards && i >= cards.length && results.length < cards.length;
  const roundOver = !!cards && cards.length > 0 && i >= cards.length && !grading;
  const missedThisRound = roundOver ? results.filter((r) => isMiss(r.grade)).map((r) => r.card) : [];
  useEffect(() => {
    if (!autoReplay || !roundOver) return;
    if (!replaying) setFirstPass(results);
    if (missedThisRound.length === 0) return;
    setResults([]);
    setI(0);
    setReplaying(true);
    setRound((n) => n + 1);
    setCards(missedThisRound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundOver]);

  if (!cards) return <LoadingScreen />;
  if (cards.length === 0)
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-muted">
          {scope === "step"
            ? "Rien à travailler ici : les éléments de cette étape sont déjà acquis."
            : checkup
              ? "Aucun exercice disponible pour cette leçon."
              : autoReplay
                ? "Rien à réviser pour l'instant : aucune carte n'est encore en rotation."
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
  if (grading || (autoReplay && roundOver && missedThisRound.length > 0)) return <LoadingScreen />;
  if (i >= cards.length || !card) {
    function restart(deck?: Exercise[]) {
      setResults([]);
      setFirstPass(null);
      setI(0);
      setRound((n) => n + 1);
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
        results={autoReplay && firstPass ? firstPass : results}
        title={checkup ? "Acquis vérifiés" : scope === "step" ? "Étape terminée" : "Révision terminée"}
        note={checkup ? PRACTICE_SUMMARY : replaying && !autoReplay ? REPLAY_SUMMARY : undefined}
        // Dans le parcours, l'étape est validée en fin de bilan : ses ratés ont déjà été
        // rejoués, et la refaire se fait depuis la page de la leçon (entraînement).
        onRestart={autoReplay ? undefined : () => restart()}
        onReplayMissed={autoReplay ? undefined : (missed) => restart(missed)}
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
    const ms = Date.now() - shownAt.current;
    let daysBefore = 0;
    try {
      daysBefore = await daysBeforeGrade(graded);
      if (!practice) await gradeCard(graded, g, new Date(), { ms });
      // Relance réussie : aucune note, mais le niveau de l'exercice est bel et bien atteint.
      else if (replaying && !isMiss(g)) await recordLevel(graded);
    } catch (e) {
      // Une note qui ne s'écrit pas ne doit pas bloquer la séance : la réponse compte au bilan.
      console.error("Note non enregistrée", e);
    } finally {
      setResults((r) => [...r, { card: graded, grade: g, daysBefore }]);
    }
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
        key={`${round}:${card.key}`}
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
