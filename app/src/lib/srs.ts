// Répétition espacée — FSRS via `ts-fsrs` (SPEC §2.3). Trois pistes (vocab/kanji/grammaire),
// trois compétences pour le vocabulaire ; chaque (élément, compétence) porte sa propre Card.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from "ts-fsrs";

export type { Card };
export { State };

/** Note de révision exposée à l'app, mappée sur les Rating FSRS. */
export type SrsGrade = "again" | "hard" | "good" | "easy";

const GRADE_TO_RATING: Record<SrsGrade, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

/** Nouvelle carte vierge (élément jamais révisé). */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

/** Applique une note ; retourne la carte mise à jour (avec nouvelle échéance `due`). */
export function review(card: Card, grade: SrsGrade, now: Date = new Date()): Card {
  return scheduler.next(card, now, GRADE_TO_RATING[grade]).card;
}

/** La carte est-elle due à la date donnée ? */
export function isDue(card: Card, now: Date = new Date()): boolean {
  return card.due.getTime() <= now.getTime();
}

/** Trie des cartes par urgence (la plus en retard / due le plus tôt d'abord). */
export function byUrgency<T extends { card: Card }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.card.due.getTime() - b.card.due.getTime());
}
