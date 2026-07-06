import { SRS } from "./config";

export type Theme = "system" | "dark" | "light";

export interface ReminderSettings {
  enabled: boolean;
  /** Heure locale à partir de laquelle le rappel du jour peut se montrer (9, 13 ou 19). */
  hour: number;
}

export interface AppSettings {
  furiganaDefault: boolean;
  glossDefault: boolean;
  /** Estompage : masque gloss et furigana des mots marqués « connus » dans le lecteur. */
  glossHideKnown: boolean;
  dailyGoal: number;
  newPerDay: number;
  theme: Theme;
  warmupRomaji: boolean;
  /** Révisions sans le son : les exercices d'écoute sont remplacés par de l'écrit
   * (cloze de production noté sur la carte orale) tant que le réglage est actif. */
  silentReviews: boolean;
  /** Vitesse de lecture audio des histoires en japonais (1 = vitesse normale). */
  storyRate: number;
  /** Rappels de révisions (notification locale + badge d'icône). Opt-in. */
  reminders: ReminderSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  furiganaDefault: false,
  glossDefault: true,
  glossHideKnown: true,
  dailyGoal: SRS.dailyGoal,
  newPerDay: SRS.newPerDay,
  theme: "system",
  warmupRomaji: true,
  silentReviews: false,
  storyRate: 1,
  reminders: { enabled: false, hour: 9 },
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("settings");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
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
