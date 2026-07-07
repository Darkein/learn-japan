import { useEffect, useState, type ReactNode } from "react";
import { analyze } from "../lib/analyze";
import { loadContentDict } from "../lib/data";
import {
  comprehensionExercises,
  kanjiChoiceExercises,
  kanjiReadingExercises,
  particleExercises,
  sentenceBuildExercises,
} from "../lib/exerciseBuild";
import { daysBeforeGrade, gradeExercise, TRACK_FR, type Exercise } from "../lib/exercise";
import type { GenState } from "../lib/genClient";
import { splitJaSentences } from "../lib/kana";
import { ensureStoryTranslationById } from "../lib/podcast";
import type { SrsGrade } from "../lib/srs";
import { ensureComprehensionQuiz } from "../lib/stories";
import type { KuromojiToken } from "../lib/tokenizer";
import { ExerciseCard } from "./exercise/ExerciseCard";
import { Button } from "./kit/Button";
import { IconClose } from "./kit/Icon";
import { Sheet } from "./kit/Sheet";
import { SessionSummary } from "./SessionSummary";

const STATE_LABEL: Record<GenState, string> = {
  queued: "en file",
  generating: "génération…",
  ready: "prêt",
  error: "erreur",
  unknown: "…",
};

interface Props {
  /** Identifiant de l'histoire en base (cache le QCM/la traduction). Absent pour une lecture libre. */
  storyId?: string;
  text: string;
  level: number;
  /** Tokens de l'article entier, pour le quiz de particules. */
  tokens: KuromojiToken[];
  /** Points de grammaire de la leçon (mêmes index pour ids/labels) ; absent hors leçon. */
  grammar?: { ids: string[]; labels: string[] };
  onClose: () => void;
}

/** Taille maximale du deck d'exercices d'une histoire. */
const MAX_DECK = 10;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function buildSentenceExercises(ja: string[], fr: string[]): Promise<Exercise[]> {
  const sentences: { fr: string; tokens: KuromojiToken[] }[] = [];
  for (let k = 0; k < ja.length; k++) {
    const analyzed = await analyze(ja[k]);
    sentences.push({ fr: fr[k] ?? "", tokens: analyzed.tokens.map((t) => t.token) });
  }
  return sentenceBuildExercises(sentences);
}

/**
 * Session d'exercices du Lecteur, plein écran : particules, QCM de compréhension et
 * reconstruction de phrases mélangés en un seul deck, terminée par le Bilan partagé
 * (cf. `SessionSummary`, factorisé depuis l'Échauffement).
 */
export function ReaderExercises({ storyId, text, level, tokens, grammar, onClose }: Props) {
  const [fullDeck, setFullDeck] = useState<Exercise[] | null>(null);
  const [deck, setDeck] = useState<Exercise[] | null>(null);
  const [genState, setGenState] = useState<GenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ card: Exercise; grade: SrsGrade; daysBefore: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGenState("queued");
    (async () => {
      // Dico de contenu chargé d'abord : les exercices de kanji ont besoin des sens FR
      // (meaningFor lit l'instantané synchrone). Idempotent et mis en cache après coup.
      await loadContentDict();
      // Traduction alignée d'abord : partagée entre particules (contextFr de la phrase
      // du trou) et reconstruction de phrases — elle était déjà sur leur chemin critique.
      const compPromise = ensureComprehensionQuiz(
        storyId, text, level, grammar ?? { ids: [], labels: [] },
        (s) => {
          if (!cancelled) setGenState(s);
        },
      ).then(comprehensionExercises);
      const { sentences: fr } = await ensureStoryTranslationById(storyId, text, level);
      const ja = splitJaSentences(text);
      const particles = particleExercises(tokens, 8, { ja, fr });
      const kanjiChoice = kanjiChoiceExercises(tokens);
      const [comp, built, kanjiRead] = await Promise.all([
        compPromise,
        buildSentenceExercises(ja, fr),
        kanjiReadingExercises(tokens),
      ]);
      // Deck plafonné : la compréhension (peu de questions, générées pour l'histoire)
      // passe toujours, le reste complète jusqu'au plafond.
      const rest = shuffle([...particles, ...built, ...kanjiRead, ...kanjiChoice]).slice(
        0,
        Math.max(0, MAX_DECK - comp.length),
      );
      return shuffle([...comp, ...rest]);
    })()
      .then((mixed) => {
        if (cancelled) return;
        setGenState("ready");
        setFullDeck(mixed);
        setDeck(mixed);
        if (mixed.length === 0) setError("Pas d'exercice disponible pour cette histoire.");
      })
      .catch((e) => {
        if (cancelled) return;
        setGenState("error");
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // Régénère si l'histoire change ; les autres props sont stables pour une histoire donnée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, text]);

  const card = deck && i < deck.length ? deck[i] : null;

  function shell(body: ReactNode) {
    return (
      <Sheet open onClose={onClose} variant="fullscreen">
        <Button variant="ghost" className="self-end" onClick={onClose}>
          <IconClose size={16} />
          Fermer
        </Button>
        {body}
      </Sheet>
    );
  }

  if (error) return shell(<p className="text-sm text-accent">{error}</p>);

  if (!deck) {
    return shell(
      <p className="text-sm text-muted">
        Préparation des exercices… {genState ? STATE_LABEL[genState] : ""}
      </p>,
    );
  }

  if (i >= deck.length || !card) {
    function restart(replay?: Exercise[]) {
      setResults([]);
      setI(0);
      setDeck(replay ?? shuffle(fullDeck ?? []));
    }

    return shell(
      <SessionSummary
        results={results}
        title="Exercices terminés"
        onRestart={() => restart()}
        onReplayMissed={(missed) => restart(missed)}
        onClose={onClose}
      />,
    );
  }

  function nextCard() {
    setI((n) => n + 1);
  }

  async function persistGrade(g: SrsGrade) {
    const graded = card!;
    const daysBefore = await daysBeforeGrade(graded);
    await gradeExercise(graded, g);
    setResults((r) => [...r, { card: graded, grade: g, daysBefore }]);
  }

  return shell(
    <div className="flex flex-col gap-4">
      <span className="text-xs uppercase tracking-wider text-muted">
        Exercices {i + 1} / {deck.length} ·{" "}
        <span className="text-accent-2">{TRACK_FR[card.track]}</span>
      </span>
      <ExerciseCard key={card.key} exercise={card} onGraded={(g) => void persistGrade(g)} onNext={nextCard} />
    </div>,
  );
}
