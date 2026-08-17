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
// ressort que faute de mieux, et jamais avec une durée qu'il ne tiendrait pas.
//
// RÈGLE : aucune branche ne doit affirmer quelque chose de faux. Le nombre de cartes dues est
// recalculé au moment du rappel (donc exact) ; tout ce qui vient du hint est daté, et chaque
// donnée ne survit à sa date que si elle reste vraie sans l'app (voir la garde de fraîcheur).

import type { FlowActivityKind } from "./flow";

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

/**
 * Combien de jours le PELOTON d'éléments survit à sa date. Une carte due hier et non révisée
 * l'est encore aujourd'hui, et la réviser suppose d'ouvrir l'app — ce qui réécrit le hint.
 * Le peloton reste donc vrai tant que l'app dort ; la borne ne protège que du hint fossile,
 * dont l'inventaire a pu bouger.
 */
const ITEMS_STALE_DAYS = 14;

/** Un titre de leçon/histoire trop long tronquerait la notification côté OS. */
const MAX_LABEL = 60;

export interface ReminderNotification {
  title: string;
  body: string;
  /** Clé de l'événement mis en avant, à mémoriser pour ne pas le rejouer (voir `lastEvent`). */
  eventShown?: string;
}

export interface ReminderItem {
  /** Ce qui s'affiche tel quel : 「花火」 pour un mot, « は (thème) » pour la grammaire. */
  text: string;
  kind: "vocab" | "grammar";
}

/**
 * Un rendez-vous identifiable, qui n'arrive pas tous les jours : une relecture-miroir, une
 * leçon débloquée, une histoire jamais lue. Sa `key` sert de mémoire — on l'annonce UNE fois,
 * pas tous les soirs tant que l'utilisateur ne s'en occupe pas.
 */
export interface ReminderEvent {
  key: string;
  kind: "mirror" | "lesson" | "read-story";
  label?: string;
  /** Âge en jours de l'histoire à relire (`mirror`). */
  ageDays?: number;
}

export interface ReminderHint {
  /** Date locale (YYYY-MM-DD) du calcul. */
  date: string;
  /** Activité choisie par `pickNext` — le TYPE, pas son libellé de bouton. */
  kind: FlowActivityKind;
  /** Éléments dus déjà révisés, les plus en retard d'abord (voir reminderItem.ts). */
  items?: ReminderItem[];
  /** Le rendez-vous du moment, s'il y en a un — indépendant du dû. */
  event?: ReminderEvent;
  /** Jours consécutifs à objectif atteint. Absent, 0 ou 1 = pas de série à évoquer. */
  streak?: number;
}

/** Écart en jours calendaires entre deux dates locales (YYYY-MM-DD), sans fuseau. */
function daysBetween(from: string, to: string): number {
  const at = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** Index stable dérivé de la date locale : varie d'un jour à l'autre, jamais dans la journée. */
function dayIndex(today: string, n: number): number {
  let h = 0;
  for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0;
  return h % n;
}

/** L'élément du soir, pioché dans le peloton par la date : deux soirs de suite en diffèrent. */
export function pickFromPool(items: ReminderItem[], today: string): ReminderItem | undefined {
  if (items.length === 0) return undefined;
  return items[dayIndex(today, items.length)];
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
 * Le rendez-vous du moment. Il passe DEVANT le dû : une relecture-miroir arrive au plus une
 * fois par quinzaine, une leçon se débloque de loin en loin, alors qu'un mot dû, il y en a
 * tous les jours. Annoncé une seule fois par candidat (`eventShown`), sinon il squatterait
 * tous les soirs jusqu'à ce qu'on s'en occupe.
 */
function eventNotification(ev: ReminderEvent, streak?: number): ReminderNotification {
  const label = clamp(ev.label);
  const out = { eventShown: ev.key };
  switch (ev.kind) {
    case "mirror":
      return {
        ...out,
        title: label ? `Et si tu relisais « ${label} » ?` : "Une vieille histoire t'attend.",
        body: body(
          streak,
          ev.ageDays
            ? `Tu l'as lue il y a ${ev.ageDays} jours. Vois ce que tu en comprends aujourd'hui.`
            : "Vois ce que tu en comprends aujourd'hui.",
        ),
      };
    case "lesson":
      return {
        ...out,
        title: "Ta prochaine leçon est prête.",
        body: body(streak, label ? `« ${label} » t'attend quand tu veux.` : "Elle t'attend quand tu veux."),
      };
    default:
      return {
        ...out,
        title: label ? `Et si tu lisais « ${label} » ?` : "Une histoire t'attend.",
        body: body(streak, "Elle est dans ta leçon en cours."),
      };
  }
}

/**
 * L'accroche par le contenu : on nomme l'élément et on demande s'il est encore là — et on
 * promet de le retrouver dans les révisions du jour. Les deux doivent être vrais : le
 * peloton ne contient que des cartes déjà révisées, dues, et que la session servira
 * effectivement (`isTrainableVocab` — voir refreshReminderState, lib/reminders.ts).
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
 * Le compte, quand il ne reste que lui. La promesse est taillée à la taille du dû : sur un
 * gros backlog on propose la première bouchée (les plus urgentes passent d'abord dans la
 * session) plutôt qu'une durée intenable.
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
 * Titre et corps du rappel, dans l'ordre de ce qui mérite le plus d'être dit :
 * ① le rendez-vous du moment, s'il n'a pas déjà été annoncé ;
 * ② un élément dû, nommé — l'accroche par le contenu ;
 * ③ le compte, faute d'élément ;
 * ④ l'omikuji du jour ;
 * ⑤ le générique.
 *
 * `today` est OBLIGATOIRE (et non déduit d'une horloge) : la fonction reste pure, et
 * l'appelant a de toute façon déjà sa date locale sous la main. `lastEvent` est la clé du
 * dernier rendez-vous annoncé (meta `reminder.lastEvent`).
 */
export function reminderNotification(
  due: number,
  hint: ReminderHint | undefined,
  today: string,
  lastEvent?: string,
): ReminderNotification {
  // Fraîcheur : l'activité, l'événement et la série datent du dernier passage dans l'app et
  // ont pu être consommés depuis. Le peloton d'éléments, lui, reste vrai tant que l'app dort.
  const fresh = hint && hint.date === today ? hint : undefined;
  const streak = fresh?.streak;
  const stale = hint ? daysBetween(hint.date, today) : Infinity;
  const items = hint && stale >= 0 && stale <= ITEMS_STALE_DAYS ? (hint.items ?? []) : [];

  if (fresh?.event && fresh.event.key !== lastEvent) return eventNotification(fresh.event, streak);
  if (due > 0) {
    const item = pickFromPool(items, today);
    return item ? itemNotification(item, due, streak) : countNotification(due, streak);
  }
  if (fresh?.kind === "omikuji") {
    return {
      title: "Ton omikuji du jour t'attend.",
      body: body(streak, "Tire ta fortune au temple, et le défi qui va avec."),
    };
  }
  // Journée vide : rien de dû, pas d'omikuji. Redire le rendez-vous en attente vaut mieux
  // qu'une phrase creuse — la répétition ne coûte que les jours où il n'y avait rien d'autre.
  if (fresh?.event) return eventNotification(fresh.event, streak);
  return streak ? { ...GENERIC, body: body(streak, GENERIC.body) } : GENERIC;
}
