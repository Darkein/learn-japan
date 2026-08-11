// Texte du rappel quotidien — PUR, partagé entre l'app et le service worker.
// Même raison d'être que dueCount.ts : le SW ne peut pas importer flow.ts (qui tire
// reviewSession → ts-fsrs), donc l'app lui laisse un indice pré-calculé en meta
// (`reminder.hint`) et c'est ici, sans IO, qu'on en tire une notification.
//
// TITRE + CORPS : le titre porte l'accroche (une question, un mot, une histoire), le corps
// le contexte (la série, ce qui attend derrière). L'OS affiche déjà le nom de l'app au-dessus,
// le titre n'a pas à le répéter.
//
// CE QU'ON MET EN AVANT : le contenu, pas le compteur. « 51 révisions t'attendent » annonce
// une corvée ; « Tu te souviens de 「花火」 ? » rappelle pourquoi on est là. Le compte ne
// ressort que faute de mieux (indice périmé), et jamais avec une durée qu'il ne tiendrait pas.
//
// RÈGLE : aucune branche ne doit affirmer quelque chose de faux. Le nombre de révisions est
// recalculé au moment du rappel (donc exact), mais l'indice date de la dernière ouverture de
// l'app — d'où la garde de fraîcheur, qui renvoie au texte générique.

import type { FlowActivityKind } from "./flow";
import type { ReminderItem } from "./reminderItem";

/** Le tag fait qu'un rappel REMPLACE le précédent au lieu de s'empiler dans le centre. */
export const REMINDER_TAG = "revision";

/** Repli quand rien n'est identifiable : une invitation, jamais une affirmation. */
const GENERIC: ReminderNotification = {
  title: "Cinq minutes de japonais ?",
  body: "Ton programme du jour t'attend.",
};

/**
 * Combien de cartes tiennent VRAIMENT dans cinq minutes. Une carte prend ~20–30 s (lecture,
 * audio, saisie, correction) : au-delà d'une dizaine, promettre « 5 minutes suffisent » est
 * un mensonge. Volontairement distinct de `SRS.sessionCap` (30), qui borne la session, pas
 * la promesse.
 */
const FIVE_MIN_CARDS = 10;

/** Un titre de leçon/histoire trop long tronquerait la notification côté OS. */
const MAX_LABEL = 60;

export interface ReminderNotification {
  title: string;
  body: string;
}

export interface ReminderHint {
  /** Date locale (YYYY-MM-DD) du calcul. Un indice d'hier est ignoré. */
  date: string;
  /** Activité choisie par `pickNext` — le TYPE, pas son libellé de bouton. */
  kind: FlowActivityKind;
  /** Titre de la leçon ou de l'histoire visée, quand l'activité en désigne une. */
  label?: string;
  /** Élément dû déjà révisé, mis en avant quand il reste du dû (voir reminderItem.ts). */
  item?: ReminderItem;
  /** Âge en jours de l'histoire à relire (activité `mirror`). */
  ageDays?: number;
  /** Jours consécutifs à objectif atteint. Absent ou 0 = pas de série à évoquer. */
  streak?: number;
}

function clamp(label: string | undefined): string | undefined {
  const t = label?.trim();
  if (!t) return undefined;
  return t.length > MAX_LABEL ? `${t.slice(0, MAX_LABEL - 1)}…` : t;
}

/** Rappel de série, en tête du corps quand elle existe. Jamais un reproche, juste un état. */
function streakLine(streak: number | undefined): string | undefined {
  if (!streak || streak < 2) return undefined;
  return `Ta série de ${streak} jours tient toujours.`;
}

function body(streak: number | undefined, rest: string): string {
  const s = streakLine(streak);
  return s ? `${s} ${rest}` : rest;
}

/**
 * L'accroche par le contenu : on nomme l'élément et on demande s'il est encore là. Vrai par
 * construction — `pickReminderItem` n'a retenu qu'une carte déjà révisée et due aujourd'hui.
 */
function itemNotification(item: ReminderItem, due: number, streak?: number): ReminderNotification {
  const title =
    item.kind === "vocab"
      ? `Tu te souviens de 「${item.text}」 ?`
      : `Et « ${item.text} », ça te revient ?`;
  const rest =
    due > 1 ? "Il t'attend dans tes révisions du jour." : "C'est ta seule carte due aujourd'hui.";
  return { title, body: body(streak, rest) };
}

/**
 * Le compte, quand l'indice a vieilli et qu'il ne reste que lui. La promesse est taillée à
 * la taille du dû : sur un gros backlog on propose la première bouchée (les plus urgentes
 * passent d'abord dans la session) plutôt qu'une durée intenable.
 */
function countNotification(due: number, streak?: number): ReminderNotification {
  const title = `${due} révision${due > 1 ? "s" : ""} t'attend${due > 1 ? "ent" : ""}.`;
  if (due <= 3) return { title, body: body(streak, "C'est vite plié.") };
  if (due <= FIVE_MIN_CARDS) return { title, body: body(streak, "Cinq minutes suffisent.") };
  return {
    title,
    body: body(streak, `Commence par les ${FIVE_MIN_CARDS} plus urgentes, le reste attendra.`),
  };
}

/**
 * Titre et corps du rappel. `today` est OBLIGATOIRE (et non déduit d'une horloge) : la
 * fonction reste pure, et l'appelant a de toute façon déjà sa date locale sous la main.
 */
export function reminderNotification(
  due: number,
  hint: ReminderHint | undefined,
  today: string,
): ReminderNotification {
  const fresh = hint && hint.date === today ? hint : undefined;
  const streak = fresh?.streak;
  // Du dû ET un élément identifié : c'est la meilleure accroche, on la prend.
  if (due > 0 && fresh?.item) return itemNotification(fresh.item, due, streak);
  // Du dû sans élément (indice périmé, ou tout le dû est encore neuf) : reste le compte.
  if (due > 0) return countNotification(due, streak);
  if (!fresh) return GENERIC;
  const label = clamp(fresh.label);
  switch (fresh.kind) {
    case "lesson":
      return {
        title: "Ta prochaine leçon est prête.",
        body: body(streak, label ? `« ${label} » t'attend quand tu veux.` : "Elle t'attend quand tu veux."),
      };
    case "read-story":
      return {
        title: label ? `Et si tu lisais « ${label} » ?` : "Une histoire t'attend.",
        body: body(streak, "Elle est dans ta leçon en cours, rien à réviser avant."),
      };
    case "mirror":
      return {
        title: label ? `Et si tu relisais « ${label} » ?` : "Une vieille histoire t'attend.",
        body: body(
          streak,
          fresh.ageDays
            ? `Tu l'as lue il y a ${fresh.ageDays} jours. Vois ce que tu en comprends aujourd'hui.`
            : "Vois ce que tu en comprends aujourd'hui.",
        ),
      };
    case "omikuji":
      return {
        title: "Ton omikuji du jour t'attend.",
        body: body(streak, "Tire ta fortune au temple, et le défi qui va avec."),
      };
    // review/reinforce sans dû (l'indice a vieilli dans la journée) et done : rien à annoncer.
    default:
      return streak ? { ...GENERIC, body: body(streak, GENERIC.body) } : GENERIC;
  }
}
