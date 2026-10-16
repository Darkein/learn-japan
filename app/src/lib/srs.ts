// Répétition espacée — FSRS via `ts-fsrs` (SPEC §2.3). Trois pistes (vocab/kanji/grammaire),
// et UNE carte par élément : un mot a une échéance, pas une par compétence — c'est la forme
// de l'exercice qui varie d'un passage à l'autre (cf. lib/vocabDrills.ts).

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from "ts-fsrs";
import { SRS } from "./config";

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

// Cible de rétention FIXE : 90 %, le défaut FSRS (SPEC §2.3). L'auto-réglage qui la
// relevait quand on se trompait est retiré : il raccourcissait les intervalles, gonflait le
// dû, et la rétention mesurée ne remontait pas pour autant.
export const REQUEST_RETENTION = 0.9;
const scheduler = fsrs(generatorParameters({ request_retention: REQUEST_RETENTION, enable_fuzz: true }));

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

/** La carte est-elle maîtrisée (FSRS Review + intervalle ≥ seuil) ? */
export function isMastered(card: Card): boolean {
  return card.state === State.Review && card.scheduled_days >= SRS.masteredIntervalDays;
}

/**
 * L'élément est-il ACQUIS (carte en état `Review`) ? C'est ce qui le dispense des étapes de
 * découverte de sa leçon quand il a déjà été rencontré et réussi ailleurs (SPEC §5.6).
 */
export function isAcquired(card: Card | undefined): boolean {
  return !!card && card.state === State.Review;
}

/**
 * Probabilité de rappel FSRS à l'instant `now` (0..1). Sert à choisir les éléments les plus
 * FRAGILES quand une étape Révision manque de cartes dues (SPEC §5.4).
 */
export function retrievability(card: Card, now: Date = new Date()): number {
  return scheduler.get_retrievability(card, now, false);
}
