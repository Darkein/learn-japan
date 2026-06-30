import { useEffect, useRef, useState } from "react";
import { toHiragana } from "wanakana";
import { normalizeReading } from "../lib/kana";
import { speakWord } from "../lib/tts";
import { isMastered, type SrsGrade } from "../lib/srs";
import { SRS } from "../lib/config";
import { getVocab, getGrammar, getComprehensionItem } from "../lib/db";
import { buildSession, gradeCard, type WarmupCard, type SessionOpts } from "../lib/warmup";
import { useSettings } from "./useSettings";

const GRADES: { id: SrsGrade; label: string }[] = [
  { id: "again", label: "Raté" },
  { id: "hard", label: "Difficile" },
  { id: "good", label: "Bien" },
  { id: "easy", label: "Facile" },
];

const TRACK_FR: Record<WarmupCard["track"], string> = {
  vocab: "vocabulaire",
  grammar: "grammaire",
  comprehension: "compréhension",
};

interface SummaryEntry {
  card: WarmupCard;
  grade: SrsGrade;
  mastered: boolean;
  intervalDaysBefore: number;
  intervalDays: number;
}

interface Props {
  opts?: SessionOpts;
  onExit?: () => void;
}

export function Warmup({ opts, onExit }: Props) {
  const { settings, update } = useSettings();
  const [cards, setCards] = useState<WarmupCard[] | null>(null);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [entry, setEntry] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [listened, setListened] = useState(false);
  const [romaji, setRomaji] = useState(() => settings.warmupRomaji);
  const [results, setResults] = useState<{ card: WarmupCard; grade: SrsGrade; daysBefore: number }[]>([]);
  const [summary, setSummary] = useState<SummaryEntry[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  useEffect(() => {
    if ((card?.mode === "type" || (card?.mode === "listen" && listened)) && correct === null)
      inputRef.current?.focus();
  }, [card, correct, listened]);

  useEffect(() => {
    if (!cards || cards.length === 0 || i < cards.length || results.length === 0) return;
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
  }, [cards, i, results]);


  if (!cards) return <p className="text-muted">Chargement…</p>;
  if (cards.length === 0)
    return (
      <p className="text-muted">
        Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici.
      </p>
    );
  if (i >= cards.length || !card) {
    const missed = results.filter((r) => r.grade === "again" || r.grade === "hard");
    const leeches = results.filter((r) => r.card.isLeech);

    function restart(deck?: WarmupCard[]) {
      setSummary(null);
      setResults([]);
      setI(0);
      setRevealed(false);
      setEntry("");
      setCorrect(null);
      setListened(false);
      if (deck) {
        setCards(deck);
      } else {
        setCards(null);
        void buildSession(new Date(), opts ?? {}).then(setCards);
      }
    }

    return (
      <div className="flex flex-col gap-4 rounded-md border border-hairline bg-surface px-4 py-6">
        <div>
          <span className="text-xs uppercase tracking-widest text-muted">Bilan</span>
          <p className="font-serif text-lg text-text">
            Échauffement terminé — {results.length} élément{results.length > 1 ? "s" : ""} revu{results.length > 1 ? "s" : ""}
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
          <button
            className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm text-white"
            onClick={() => restart()}
          >
            Recommencer
          </button>
          <button
            className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={missed.length === 0}
            onClick={() => restart(missed.map((r) => r.card))}
          >
            Rejouer les ratés {missed.length > 0 ? `(${missed.length})` : ""}
          </button>
          {onExit && (
            <button
              className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-sm text-text transition-colors hover:border-accent"
              onClick={onExit}
            >
              Retour
            </button>
          )}
        </div>
      </div>
    );
  }

  function nextCard() {
    setRevealed(false);
    setEntry("");
    setCorrect(null);
    setListened(false);
    setI((n) => n + 1);
  }

  async function fetchDaysBefore(c: WarmupCard): Promise<number> {
    if (c.track === "vocab") {
      const item = await getVocab(c.id);
      return item?.cards?.written?.scheduled_days ?? 0;
    } else if (c.track === "grammar") {
      const item = await getGrammar(c.id);
      return item?.card?.scheduled_days ?? 0;
    } else {
      const item = await getComprehensionItem(c.id);
      return item?.card?.scheduled_days ?? 0;
    }
  }

  async function grade(g: SrsGrade) {
    const graded = card!;
    const daysBefore = await fetchDaysBefore(graded);
    await gradeCard(graded, g);
    setResults((r) => [...r, { card: graded, grade: g, daysBefore }]);
    nextCard();
  }

  function check() {
    if (!card?.answers) return;
    const ok = card.answers.includes(normalizeReading(toHiragana(entry)));
    setCorrect(ok);
  }

  function handleListen() {
    speakWord(card!.id.split("|")[0]);
    setListened(true);
  }

  const isTypeMode = card.mode === "type" || (card.mode === "listen" && listened);

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs uppercase tracking-wider text-muted">
        Échauffement {i + 1} / {cards.length} ·{" "}
        <span className="text-accent-2">{TRACK_FR[card.track]}</span>
      </span>
      <div className="flex flex-col items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-12 text-center">
        {card.isLeech && (
          <span className="mb-1 inline-block rounded-sm bg-surface px-2 py-0.5 text-xs text-muted">
            Élément difficile
          </span>
        )}

        {card.mode === "listen" && !listened ? (
          <>
            <div className="font-jp text-3xl">{card.front}</div>
            <button
              className="cursor-pointer rounded-sm bg-accent px-6 py-2 text-white"
              onClick={handleListen}
            >
              ▶ Écouter
            </button>
          </>
        ) : (
          <>
            <div className="font-jp text-3xl">{card.front}</div>

            {isTypeMode ? (
              correct === null ? (
                <>
                  {card.prompt && <span className="text-sm text-muted">{card.prompt}</span>}
                  <div className="relative w-full max-w-xs">
                    <input
                      ref={inputRef}
                      className="w-full rounded-sm border border-hairline bg-bg px-3 py-2 text-center font-jp text-xl text-text outline-none focus:border-accent"
                      value={entry}
                      onChange={(e) => {
                        const v = romaji
                          ? toHiragana(e.target.value, { IMEMode: "toHiragana" })
                          : e.target.value;
                        setEntry(v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && entry.trim()) check();
                      }}
                      lang="ja"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      aria-label={card.prompt ?? "Réponse"}
                    />
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-sm px-1 text-xs text-muted transition-colors hover:text-text"
                      onClick={() => {
                        const v = !romaji;
                        setRomaji(v);
                        update({ warmupRomaji: v });
                        inputRef.current?.focus();
                      }}
                      title={romaji ? "Romaji → kana activé" : "Romaji → kana désactivé"}
                      tabIndex={-1}
                    >
                      {romaji ? "あ" : "A"}
                    </button>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      className="cursor-pointer rounded-sm bg-accent px-6 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={check}
                      disabled={!entry.trim()}
                    >
                      Vérifier
                    </button>
                    <button
                      className="cursor-pointer rounded-sm border border-hairline px-4 py-2 text-text transition-colors hover:border-accent"
                      onClick={() => setCorrect(false)}
                    >
                      Je ne sais pas
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={`text-sm ${correct ? "text-accent-2" : "text-accent"}`}>
                    {correct ? "✓ Correct" : "✗ Raté"}
                  </div>
                  <div className="font-jp text-xl text-muted">{card.back}</div>
                  {card.context && (
                    <p className="mt-2 text-sm text-muted italic font-jp">{card.context}</p>
                  )}
                  <div className="flex flex-wrap justify-center gap-2">
                    {correct ? (
                      <>
                        <button
                          className="grow basis-24 cursor-pointer rounded-sm border border-hairline p-2 text-sm text-text transition-colors hover:border-accent"
                          onClick={() => grade("good")}
                        >
                          Bien
                        </button>
                        <button
                          className="grow basis-24 cursor-pointer rounded-sm border border-hairline p-2 text-sm text-text transition-colors hover:border-accent"
                          onClick={() => grade("easy")}
                        >
                          Facile
                        </button>
                      </>
                    ) : (
                      <button
                        className="cursor-pointer rounded-sm bg-accent px-6 py-2 text-white"
                        onClick={() => grade("again")}
                      >
                        Continuer
                      </button>
                    )}
                  </div>
                </>
              )
            ) : revealed ? (
              <>
                <div className="font-jp text-xl text-muted">{card.back}</div>
                {card.context && (
                  <p className="mt-2 text-sm text-muted italic font-jp">{card.context}</p>
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  {GRADES.map((g) => (
                    <button
                      key={g.id}
                      className="grow basis-20 cursor-pointer rounded-sm border border-hairline p-2 text-sm text-text transition-colors hover:border-accent"
                      onClick={() => grade(g.id)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button
                className="cursor-pointer rounded-sm bg-accent px-6 py-2 text-white"
                onClick={() => setRevealed(true)}
              >
                Révéler
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
