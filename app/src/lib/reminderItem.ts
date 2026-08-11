// Choix des éléments mis en avant par le rappel du jour — PUR (données en argument).
// L'app calcule un PELOTON de candidats au dernier passage et le range dans `reminder.hint` ;
// le service worker y pioche au moment d'afficher (voir `pickFromPool`, reminderText.ts).
// Rien ne part sur le réseau : le hint vit dans le store `meta` local, comme le reste.
//
// POURQUOI UN PELOTON ET NON UN SEUL ÉLÉMENT : le hint n'est réécrit qu'à l'ouverture de
// l'app. Quelqu'un qui ne l'ouvre pas de la semaine verrait sinon le même mot tous les soirs.
// C'est donc le SW, qui sait quel jour on est, qui tranche.
//
// RÈGLE : on ne met en avant qu'un élément DÉJÀ RÉVISÉ au moins une fois (`reps > 0`).
// Une carte fraîchement créée est due immédiatement, et « tu te souviens de … ? » sur un
// mot jamais vu serait un mensonge.

import type { ReminderItem } from "./reminderText";

/** Sous-ensemble d'une carte FSRS nécessaire au choix (pas d'import ts-fsrs ici). */
export interface PickCardLike {
  due: Date;
  reps: number;
}
export interface PickVocabLike {
  /** Graphie de référence, kanji compris : c'est elle qu'on affiche. */
  surface: string;
  cards: Partial<Record<string, PickCardLike | undefined>>;
}
export interface PickGrammarLike {
  name: string;
  card?: PickCardLike;
}

/**
 * Taille du peloton. Assez large pour que les soirs ne se ressemblent pas, assez court pour
 * rester dans un enregistrement `meta` léger — et pour ne proposer que du vraiment en retard.
 */
export const POOL_SIZE = 12;

/**
 * Les éléments dus à mettre en avant, les plus en retard d'abord (ce sont eux qui risquent
 * l'oubli). Vide si rien de révisé n'est dû.
 */
export function reminderItemPool(
  vocab: PickVocabLike[],
  grammar: PickGrammarLike[],
  now: Date,
): ReminderItem[] {
  const seen = (c: PickCardLike | undefined) =>
    !!c && c.reps > 0 && c.due.getTime() <= now.getTime();
  const candidates: { item: ReminderItem; due: number }[] = [];
  for (const v of vocab) {
    // La compétence écrite seule : c'est la face qu'on peut nommer dans une notification.
    const c = v.cards.written;
    if (seen(c) && v.surface) {
      candidates.push({ item: { text: v.surface, kind: "vocab" }, due: c!.due.getTime() });
    }
  }
  for (const g of grammar) {
    if (seen(g.card) && g.name) {
      candidates.push({ item: { text: g.name, kind: "grammar" }, due: g.card!.due.getTime() });
    }
  }
  // Tri par retard, puis par texte : deux cartes dues à la même milliseconde (import,
  // amorçage en lot) ne doivent pas dépendre de l'ordre de lecture d'IndexedDB.
  candidates.sort((a, b) => a.due - b.due || a.item.text.localeCompare(b.item.text));
  return candidates.slice(0, POOL_SIZE).map((c) => c.item);
}
