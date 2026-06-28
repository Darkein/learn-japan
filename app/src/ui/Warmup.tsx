import { useEffect, useState } from "react";
import type { SrsGrade } from "../lib/srs";
import { dueCards, gradeCard, type WarmupCard } from "../lib/warmup";

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

export function Warmup() {
  const [cards, setCards] = useState<WarmupCard[] | null>(null);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    void dueCards().then(setCards);
  }, []);

  if (!cards) return <p className="text-muted">Chargement…</p>;
  if (cards.length === 0)
    return (
      <p className="text-muted">
        Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici.
      </p>
    );
  if (i >= cards.length)
    return <p className="text-muted">Échauffement terminé — {cards.length} élément(s) revus. 🎴</p>;

  const card = cards[i];

  async function grade(g: SrsGrade) {
    await gradeCard(card, g);
    setRevealed(false);
    setI((n) => n + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      <span className="text-xs uppercase tracking-wider text-muted">
        Échauffement {i + 1} / {cards.length} ·{" "}
        <span className="text-accent-2">{TRACK_FR[card.track]}</span>
      </span>
      <div className="flex flex-col items-center gap-4 rounded-md border border-hairline bg-surface px-4 py-12 text-center">
        <div className="font-jp text-3xl">{card.front}</div>
        {revealed ? (
          <>
            <div className="font-jp text-xl text-muted">{card.back}</div>
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
      </div>
    </div>
  );
}
