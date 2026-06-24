import { useEffect, useState } from "react";
import type { SrsGrade } from "../lib/srs";
import { dueCards, gradeCard, type WarmupCard } from "../lib/warmup";
import styles from "./Warmup.module.css";

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
};

export function Warmup() {
  const [cards, setCards] = useState<WarmupCard[] | null>(null);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    void dueCards().then(setCards);
  }, []);

  if (!cards) return <p className={styles.empty}>Chargement…</p>;
  if (cards.length === 0)
    return (
      <p className={styles.empty}>
        Rien à réviser pour l'instant. Marque des mots « à revoir » dans le Lecteur, puis reviens ici.
      </p>
    );
  if (i >= cards.length)
    return (
      <p className={styles.empty}>Échauffement terminé — {cards.length} élément(s) revus. 🎴</p>
    );

  const card = cards[i];

  async function grade(g: SrsGrade) {
    await gradeCard(card, g);
    setRevealed(false);
    setI((n) => n + 1);
  }

  return (
    <div className={styles.panel}>
      <span className={styles.progress}>
        Échauffement {i + 1} / {cards.length} ·{" "}
        <span className={styles.track}>{TRACK_FR[card.track]}</span>
      </span>
      <div className={styles.card}>
        <div className={styles.front}>{card.front}</div>
        {revealed ? (
          <>
            <div className={styles.back}>{card.back}</div>
            <div className={styles.grades}>
              {GRADES.map((g) => (
                <button key={g.id} className={styles.grade} onClick={() => grade(g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button className={styles.btn} onClick={() => setRevealed(true)}>
            Révéler
          </button>
        )}
      </div>
    </div>
  );
}
