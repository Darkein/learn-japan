import { useEffect, useState, type ReactNode } from "react";
import { analyze } from "../lib/analyze";
import { loadContentDict } from "../lib/data";
import { sentenceBuildExercises } from "../lib/exerciseBuild";
import { daysBeforeGrade, gradeExercise, TRACK_FR, type Exercise } from "../lib/exercise";
import { splitJaSentences } from "../lib/kana";
import { ensureStoryTranslationById } from "../lib/podcast";
import { shuffle } from "../lib/random";
import { buildSession } from "../lib/reviewSession";
import type { SrsGrade } from "../lib/srs";
import type { KuromojiToken } from "../lib/tokenizer";
import { ensureVocabItems } from "../lib/vocab";
import { ExerciseCard } from "./exercise/ExerciseCard";
import { Button } from "./kit/Button";
import { IconClose } from "./kit/Icon";
import { Sheet } from "./kit/Sheet";
import { SessionSummary } from "./SessionSummary";

interface Props {
  /** Identifiant de l'histoire en base (cache la traduction). Absent pour une lecture libre. */
  storyId?: string;
  text: string;
  level: number;
  /** Tokens de l'article entier : source des mots du deck. */
  tokens: KuromojiToken[];
  /** Points de grammaire de la leçon (mêmes index pour ids/labels) ; absent hors leçon. */
  grammar?: { ids: string[]; labels: string[] };
  onClose: () => void;
}

/** Taille maximale du deck d'exercices d'une histoire. */
const MAX_DECK = 10;

async function buildSentenceExercises(ja: string[], fr: string[]): Promise<Exercise[]> {
  const sentences: { fr: string; tokens: KuromojiToken[] }[] = [];
  for (let k = 0; k < ja.length; k++) {
    const analyzed = await analyze(ja[k]);
    sentences.push({ fr: fr[k] ?? "", tokens: analyzed.tokens.map((t) => t.token) });
  }
  return sentenceBuildExercises(sentences);
}

/** Reconstruction des phrases de l'histoire, ou rien si la traduction n'est pas joignable. */
async function sentenceExercisesOrNone(
  storyId: string | undefined,
  text: string,
  level: number,
): Promise<Exercise[]> {
  try {
    const { sentences } = await ensureStoryTranslationById(storyId, text, level);
    return await buildSentenceExercises(splitJaSentences(text), sentences);
  } catch {
    return [];
  }
}

/**
 * Session d'exercices du Lecteur, plein écran. Même format que la révision — les cartes du
 * triangle (kanji ↔ furigana ↔ traduction) sont bâties par `buildSession` en périmètre
 * « story », restreint aux mots du texte — plus la reconstruction de ses phrases, qui a
 * besoin de la traduction alignée propre au Lecteur. Terminée par le Bilan partagé
 * (`SessionSummary`, factorisé depuis l'Échauffement).
 */
export function ReaderExercises({ storyId, text, level, tokens, grammar, onClose }: Props) {
  const [fullDeck, setFullDeck] = useState<Exercise[] | null>(null);
  const [deck, setDeck] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState<{ card: Exercise; grade: SrsGrade; daysBefore: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      // Dico de contenu chargé d'abord : les sens FR des mots viennent de l'instantané
      // synchrone lu par meaningFor. Idempotent et mis en cache après coup.
      await loadContentDict();
      const vocabIds = await ensureVocabItems(tokens);
      const [triangle, built] = await Promise.all([
        buildSession(new Date(), {
          scope: "story",
          vocabIds,
          grammarIds: grammar?.ids ?? [],
        }),
        // La reconstruction de phrase a besoin de la traduction alignée, donc du Worker.
        // Best-effort : hors ligne ou Worker en panne, on sert quand même les cartes du
        // triangle, qui ne dépendent que de la base locale.
        sentenceExercisesOrNone(storyId, text, level),
      ]);
      return shuffle([...triangle, ...built]).slice(0, MAX_DECK);
    })()
      .then((mixed) => {
        if (cancelled) return;
        setFullDeck(mixed);
        setDeck(mixed);
        if (mixed.length === 0) setError("Pas d'exercice disponible pour cette histoire.");
      })
      .catch((e) => {
        if (cancelled) return;
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

  if (!deck) return shell(<p className="text-sm text-muted">Préparation des exercices…</p>);

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
