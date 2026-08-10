// Texte du rappel quotidien — PUR, partagé entre l'app et le service worker.
// Même raison d'être que dueCount.ts : le SW ne peut pas importer flow.ts (qui tire
// reviewSession → ts-fsrs), donc l'app lui laisse un indice pré-calculé en meta
// (`reminder.hint`) et c'est ici, sans IO, qu'on en tire une phrase.
//
// RÈGLE : aucune branche ne doit affirmer quelque chose de faux. Le nombre de révisions est
// recalculé au moment du rappel (donc exact), mais l'indice d'activité date de la dernière
// ouverture de l'app — d'où la garde de fraîcheur, qui renvoie au texte générique.

import type { FlowActivityKind } from "./flow";

/** Titre et tag de la notification — un seul endroit pour l'app, le SW et le bouton de test.
 *  Le tag fait qu'un rappel REMPLACE le précédent au lieu de s'empiler dans le centre. */
export const REMINDER_TITLE = "Learn Japan";
export const REMINDER_TAG = "revision";

/** Repli quand rien n'est identifiable : une invitation, jamais une affirmation. */
const GENERIC = "Cinq minutes de japonais ?";

/** Un titre de leçon/histoire trop long tronquerait la notification côté OS. */
const MAX_LABEL = 60;

export interface ReminderHint {
  /** Date locale (YYYY-MM-DD) du calcul. Un indice d'hier est ignoré. */
  date: string;
  /** Activité choisie par `pickNext` — le TYPE, pas son libellé de bouton. */
  kind: FlowActivityKind;
  /** Titre de la leçon ou de l'histoire visée, quand l'activité en désigne une. */
  label?: string;
}

function clamp(label: string | undefined): string | undefined {
  const t = label?.trim();
  if (!t) return undefined;
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t;
}

/**
 * Corps de la notification de rappel. `today` est OBLIGATOIRE (et non déduit d'une horloge) :
 * la fonction reste pure, et l'appelant a de toute façon déjà sa date locale sous la main.
 */
export function reminderBody(due: number, hint: ReminderHint | undefined, today: string): string {
  // Le dû passe avant tout : c'est le plus concret et le plus urgent.
  if (due > 0) {
    return `${due} révision${due > 1 ? "s" : ""} t'attend${due > 1 ? "ent" : ""} — 5 minutes suffisent.`;
  }
  if (!hint || hint.date !== today) return GENERIC;
  const label = clamp(hint.label);
  switch (hint.kind) {
    case "lesson":
      return label ? `Ta prochaine leçon est prête : ${label}.` : "Ta prochaine leçon est prête.";
    case "read-story":
      return label ? `Une histoire t'attend : ${label}.` : "Une histoire t'attend.";
    case "mirror":
      return "Une vieille histoire t'attend — mesure le chemin parcouru.";
    case "omikuji":
      return "Tire ton omikuji du jour.";
    // review/reinforce sans dû (l'indice a vieilli dans la journée) et done : rien à annoncer.
    default:
      return GENERIC;
  }
}
