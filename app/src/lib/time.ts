// Formatage relatif de dates en français — partagé par les retrouvailles, la
// relecture-miroir et le voyage. Volontairement grossier : l'app parle en jours/mois.

const DAY_MS = 24 * 60 * 60 * 1000;

/** « aujourd'hui », « hier », « il y a 12 jours », « il y a 3 mois », « il y a 2 ans ». */
export function formatDaysAgo(at: number, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(new Date(at))) / DAY_MS));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 60) return `il y a ${days} jours`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `il y a ${months} mois`;
  return `il y a ${Math.round(months / 12)} ans`;
}

/** « 25 min », « 1 h 05 » — durée d'étude affichée dans le flux et les stats. */
export function formatMinutes(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, "0")}`;
}
