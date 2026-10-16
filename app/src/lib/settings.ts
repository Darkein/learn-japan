import { DAILY_STEPS_DEFAULT } from "./path";

export type Theme = "system" | "dark" | "light";

export interface ReminderSettings {
  enabled: boolean;
  /** Heure LOCALE du rappel du jour (0-23, réglable librement — l'UI propose 6 h à 23 h).
   *  Le Web Push l'honore à l'heure dite ; les replis locaux la traitent comme un seuil
   *  « pas avant » (le navigateur choisit alors le moment). Voir lib/reminders.ts. */
  hour: number;
}

export interface AppSettings {
  furiganaDefault: boolean;
  glossDefault: boolean;
  /** Estompage : masque gloss et furigana des mots marqués « connus » dans le lecteur. */
  glossHideKnown: boolean;
  /** Objectif du jour en ÉTAPES du parcours (SPEC §5.1) : un repère pour la série et les
   *  rappels, jamais une limite — la séance continue une fois l'objectif atteint. */
  dailySteps: number;
  /** Objectif en CARTES d'avant le parcours : la série de jours le garde pour juger les
   *  jours d'avant `pathSince`, pour que le passage au parcours ne la remette pas à zéro. */
  legacyCardGoal?: number;
  /** Date locale (YYYY-MM-DD) du passage au parcours. */
  pathSince?: string;
  theme: Theme;
  warmupRomaji: boolean;
  /** Révisions sans le son : les exercices d'écoute sont remplacés par de l'écrit
   * (cloze de production noté sur la carte orale) tant que le réglage est actif. */
  silentReviews: boolean;
  /** Pause d'écoute temporaire (« Je ne peux pas écouter ») : timestamp de fin, 0 = aucune.
   * Même effet que `silentReviews` tant qu'elle court, mais elle expire toute seule. */
  silentUntil: number;
  /** Sons de retour des exercices (juste / raté / série terminée, cf. lib/sfx.ts).
   * SEUL réglage à les commander : ni `silentReviews` ni `silentUntil` ne les touchent —
   * ceux-là choisissent le CONTENU des révisions (écoute ou écrit), pas ce que l'appareil
   * a le droit d'émettre. Voir `sfxEnabled`. */
  feedbackSounds: boolean;
  /** Vitesse du lecteur audio — leçons et histoires (1 = vitesse normale). */
  storyRate: number;
  /** Échelle du texte japonais — leçons, histoires et articles (1 = taille normale). */
  readerFontScale: number;
  /** Rappels de révisions (notification locale + badge d'icône). Opt-in. */
  reminders: ReminderSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  furiganaDefault: true,
  glossDefault: true,
  glossHideKnown: true,
  dailySteps: DAILY_STEPS_DEFAULT,
  theme: "system",
  warmupRomaji: true,
  silentReviews: false,
  silentUntil: 0,
  feedbackSounds: true,
  storyRate: 1,
  readerFontScale: 1,
  reminders: { enabled: false, hour: 9 },
};

/** Durée de la pause d'écoute déclenchée par « Je ne peux pas écouter ». */
export const SILENT_PAUSE_MS = 15 * 60 * 1000;

/**
 * Faut-il servir les révisions sans le son ? Réglage permanent, ou pause temporaire encore
 * en cours — dans les deux cas les exercices d'écoute passent à leur équivalent écrit.
 *
 * Choix de CONTENU, et rien d'autre : les deux disent « pas d'exercice d'écoute », pas
 * « pas un bruit ». Les sons de retour, eux, ne dépendent que de `feedbackSounds` — ne pas
 * rebrancher cette fonction sur `sfxEnabled`, c'était le bug.
 */
export function isSilentMode(s: AppSettings, now: Date = new Date()): boolean {
  return s.silentReviews || s.silentUntil > now.getTime();
}

/** Date locale du jour (YYYY-MM-DD) — sans dépendre de db.ts, cf. `saveSettings`. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Réglages d'avant le parcours : l'objectif du jour se comptait en cartes. */
type LegacySettings = Partial<AppSettings> & { dailyGoal?: number; newPerDay?: number };

/**
 * Passage au parcours (SPEC §5.8) : l'objectif en cartes n'a pas d'équivalent en étapes,
 * il repasse au défaut. Il reste mémorisé pour la série des jours d'avant le passage, et la
 * date du passage est posée une fois pour toutes. « Nouveaux mots par jour » disparaît.
 */
function migrateToPath(parsed: LegacySettings): Partial<AppSettings> {
  if (parsed.dailySteps != null) return parsed;
  const { dailyGoal, newPerDay: _dropped, ...rest } = parsed;
  return {
    ...rest,
    dailySteps: DAILY_STEPS_DEFAULT,
    ...(dailyGoal != null ? { legacyCardGoal: dailyGoal } : {}),
    pathSince: todayLocal(),
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("settings");
    if (raw) {
      const parsed = JSON.parse(raw) as LegacySettings;
      const migrated = migrateToPath(parsed);
      if (migrated !== parsed) localStorage.setItem("settings", JSON.stringify(migrated));
      return { ...DEFAULT_SETTINGS, ...migrated };
    }
    // Migration depuis les anciennes clés indépendantes
    const theme = (localStorage.getItem("theme") as Theme) || DEFAULT_SETTINGS.theme;
    const warmupRomaji = (localStorage.getItem("warmup.romaji") ?? "1") === "1";
    return { ...DEFAULT_SETTINGS, theme, warmupRomaji };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem("settings", JSON.stringify(s));
  } catch {
    /* stockage indisponible : on ignore */
  }
  // Miroir des rappels dans IndexedDB : le service worker (periodic sync) ne lit pas
  // localStorage. Import dynamique pour garder settings.ts sans dépendance db au chargement.
  if (typeof indexedDB !== "undefined") {
    void import("./db")
      .then(({ putMeta }) => putMeta("reminders", s.reminders))
      .catch(() => {});
  }
}
