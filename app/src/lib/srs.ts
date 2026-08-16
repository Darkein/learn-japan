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

// Cible de rétention courante (`request_retention`). Ajustée à l'exécution par le module
// d'auto-réglage (lib/tuning.ts) selon le taux d'erreur mesuré : le scheduler est reconstruit
// à chaque changement. Défaut = 0.9 (défaut FSRS) tant qu'aucun réglage n'est appliqué.
let requestRetention = 0.9;
let scheduler = fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));

/** Cible de rétention actuellement appliquée au scheduler. */
export function getRequestRetention(): number {
  return requestRetention;
}

/** Reconstruit le scheduler avec une nouvelle cible de rétention (auto-réglage). */
export function setRequestRetention(r: number): void {
  requestRetention = r;
  scheduler = fsrs(generatorParameters({ request_retention: r, enable_fuzz: true }));
}

/** Nouvelle carte vierge (élément jamais révisé). */
export function newCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

/** Applique une note ; retourne la carte mise à jour (avec nouvelle échéance `due`). */
export function review(card: Card, grade: SrsGrade, now: Date = new Date()): Card {
  return scheduler.next(card, now, GRADE_TO_RATING[grade]).card;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Écart minimal, en millisecondes, avant qu'une carte SŒUR (autre compétence du même mot)
 * puisse retomber. Voir `spaceSkillCards`.
 */
export const SKILL_GAP_MS = SRS.skillGapDays * DAY_MS;

/**
 * Espace les compétences d'un même mot. Les trois cartes (écrit / écoute / production) sont
 * planifiées indépendamment : trois échéances tirées séparément finissent par se suivre, et
 * le mot semble revenir tous les jours même noté « facile » à chaque passage — c'est le cas
 * des tout premiers mots appris (私, 今日), dont les trois cartes ont été amorcées à
 * quelques jours d'intervalle.
 *
 * On repousse donc à `now + skillGapDays` les cartes du mot qui tomberaient dans la foulée
 * de celle qu'on vient de réviser. Seule `due` bouge — stabilité, difficulté et historique
 * FSRS restent intacts, et une révision retardée est correctement prise en compte (l'écart
 * réel est mesuré depuis `last_review`). Jamais d'avancement : une échéance déjà lointaine
 * n'est pas touchée.
 */
export function spaceSkillCards(
  cards: Partial<Record<string, Card>>,
  graded: string,
  now: Date = new Date(),
): void {
  const floor = now.getTime() + SKILL_GAP_MS;
  for (const [skill, card] of Object.entries(cards)) {
    if (skill === graded || !card) continue;
    if (card.due.getTime() < floor) card.due = new Date(floor);
  }
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
 * La carte est-elle assez stable pour compter dans le DÉBLOCAGE de la leçon suivante
 * (FSRS Review + intervalle ≥ seuil léger) ? Découplé de `isMastered` : la maîtrise (21 j)
 * est l'objectif long terme, le déblocage ne doit pas attendre des semaines.
 */
export function isUnlockReady(card: Card): boolean {
  return card.state === State.Review && card.scheduled_days >= SRS.unlockIntervalDays;
}
