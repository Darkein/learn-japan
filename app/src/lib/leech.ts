// Éléments difficiles (leeches) : lecture depuis le log de révisions et remise à zéro.
// Un élément est difficile quand il cumule ≥ SRS.leechLapses échecs DEPUIS sa dernière
// remise à zéro (lib/stats.ts). La session de révision s'en sert pour rétrograder la
// saisie en QCM ; le Catalogue s'en sert comme filtre et comme badge.

import {
  allReviews,
  getComprehensionItem,
  getGrammar,
  getVocab,
  logReview,
  putComprehensionItem,
  putGrammar,
  putVocab,
  RESET_GRADE,
  type ReviewLog,
  type Skill,
} from "./db";
import { newCard } from "./srs";
import { leechIds } from "./stats";

export type Track = ReviewLog["track"];

/** Ids des éléments difficiles, toutes pistes confondues (le log ne préfixe pas la piste). */
export async function loadLeechIds(): Promise<Set<string>> {
  return leechIds(await allReviews());
}

/**
 * Remet un élément à zéro : cartes FSRS neuves (il repart en apprentissage), série de
 * saisie effacée, et surtout un JALON dans le log — sans lui, les échecs déjà journalisés
 * le garderaient « difficile » à vie et le bouton n'aurait aucun effet visible.
 */
export async function resetItemProgress(track: Track, id: string, now: Date = new Date()): Promise<void> {
  if (track === "vocab") {
    const v = await getVocab(id);
    if (!v) return;
    for (const skill of Object.keys(v.cards) as Skill[]) v.cards[skill] = newCard(now);
    v.status = "review";
    v.streak = 0;
    delete v.lastDir;
    await putVocab(v);
  } else if (track === "grammar") {
    const g = await getGrammar(id);
    if (!g) return;
    g.card = newCard(now);
    g.status = "review";
    await putGrammar(g);
  } else {
    const c = await getComprehensionItem(id);
    if (!c) return;
    c.card = newCard(now);
    c.status = "review";
    await putComprehensionItem(c);
  }
  await logReview({ itemId: id, track, grade: RESET_GRADE, at: now.getTime() });
}
