import { useEffect, useRef, useState } from "react";
import { normalizeReading } from "../lib/kana";
import { speakWord } from "../lib/tts";
import type { SrsGrade } from "../lib/srs";
import { buildSession, gradeCard, type WarmupCard, type SessionOpts } from "../lib/warmup";

const GRADES: { id: SrsGrade; label: string }[] = [
  { id: "again", label: "Raté" },
  { id: "hard", label: "Difficile" },
  { id: "good", label: "Bien" },
  { id: "easy", label: "Facile" },
];

const TRACK_FR: Record<WarmupCard["track"], string> = {
  vocab: "vocabulaire",
  kanji: "kanji",
  grammar: "grammaire",
  comprehension: "compréhension",
};

interface Props {
  opts?: SessionOpts;
}

export function Warmup({ opts }: Props) {
  const [cards, setCards] = useState<WarmupCard[] | null>(null);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [entry, setEntry] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [listened, setListened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void buildSession(new Date(), opts ?? {}).then(setCards);
  }, []);

  const card = cards && i < cards.length ? cards[i] : null;

  useEffect(() => {
    if ((card?.mode === "type" || (card?.mode === "listen" && listened)) && correct === null)
      inputRef.current?.focus();
  }, [card, correct, listened]);

  if (!cards) return <p className="text-muted">Chargement…</p>;
  if (cards.length === 0)
    return (
      <p className="text-muted">
        Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici.
      </p>
    );
  if (i >= cards.length || !card)
    return <p className="text-muted">Échauffement terminé — {cards.length} élément(s) revus. 🎴</p>;

  function nextCard() {
    setRevealed(false);
    setEntry("");
    setCorrect(null);
    setListened(false);
    setI((n) => n + 1);
  }

  async function grade(g: SrsGrade) {
    await gradeCard(card!, g);
    nextCard();
  }

  function check() {
    if (!card?.answers) return;
    const ok = card.answers.includes(normalizeReading(entry));
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
                  <input
                    ref={inputRef}
                    className="w-full max-w-xs rounded-sm border border-hairline bg-bg px-3 py-2 text-center font-jp text-xl text-text outline-none focus:border-accent"
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && entry.trim()) check();
                    }}
                    lang="ja"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-label={card.prompt ?? "Réponse"}
                  />
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
