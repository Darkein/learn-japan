// Choix de l'élément mis en avant par le rappel du jour — PUR (données en argument).
// L'app le calcule au dernier passage et le range dans `reminder.hint` ; le service worker
// se contente d'en faire une phrase (voir reminderText.ts). Rien ne part sur le réseau :
// le hint vit dans le store `meta` local, comme le reste.
//
// RÈGLE : on ne met en avant qu'un élément DÉJÀ RÉVISÉ au moins une fois (`reps > 0`).
// Une carte fraîchement créée est due immédiatement, et « tu te souviens de … ? » sur un
// mot jamais vu serait un mensonge.

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

export interface ReminderItem {
  /** Ce qui s'affiche tel quel : 「花火」 pour un mot, « は (thème) » pour la grammaire. */
  text: string;
  kind: "vocab" | "grammar";
}

/**
 * Nombre de candidats parmi lesquels la date du jour tranche. Prendre systématiquement le
 * plus en retard servirait le même mot tous les soirs tant que le backlog n'est pas entamé.
 */
const POOL = 12;

/** Index stable dérivé de la date locale : varie d'un jour à l'autre, jamais dans la journée. */
function dayIndex(today: string, n: number): number {
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0;
  return h % n;
}

/**
 * L'élément dû à mettre en avant, ou `undefined` si rien de révisé n'est dû. Les plus en
 * retard d'abord (ce sont eux qui risquent l'oubli), puis la date du jour choisit dans ce
 * peloton. Déterministe : même entrée, même jour → même élément, dans l'app comme en test.
 */
export function pickReminderItem(
  vocab: PickVocabLike[],
  grammar: PickGrammarLike[],
  now: Date,
  today: string,
): ReminderItem | undefined {
  const seen = (c: PickCardLike | undefined) => !!c && c.reps > 0 && c.due.getTime() <= now.getTime();
  const candidates: { item: ReminderItem; due: number }[] = [];
  for (const v of vocab) {
    // La compétence écrite seule : c'est la face qu'on peut nommer dans une notification.
    const c = v.cards.written;
    if (seen(c) && v.surface) candidates.push({ item: { text: v.surface, kind: "vocab" }, due: c!.due.getTime() });
  }
  for (const g of grammar) {
    if (seen(g.card) && g.name) candidates.push({ item: { text: g.name, kind: "grammar" }, due: g.card!.due.getTime() });
  }
  if (candidates.length === 0) return undefined;
  // Tri par retard, puis par texte : deux cartes dues à la même milliseconde (import,
  // amorçage en lot) ne doivent pas dépendre de l'ordre de lecture d'IndexedDB.
  candidates.sort((a, b) => a.due - b.due || a.item.text.localeCompare(b.item.text));
  const pool = candidates.slice(0, POOL);
  return pool[dayIndex(today, pool.length)].item;
}
