import { SRS } from "./config";

export type Theme = "system" | "dark" | "light";

export interface AppSettings {
  furiganaDefault: boolean;
  glossDefault: boolean;
  /** Estompage : masque gloss et furigana des mots marqués « connus » dans le lecteur. */
  glossHideKnown: boolean;
  dailyGoal: number;
  newPerDay: number;
  theme: Theme;
  warmupRomaji: boolean;
  /** Vitesse de lecture audio des histoires en japonais (1 = vitesse normale). */
  storyRate: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  furiganaDefault: false,
  glossDefault: true,
  glossHideKnown: true,
  dailyGoal: SRS.dailyGoal,
  newPerDay: SRS.newPerDay,
  theme: "system",
  warmupRomaji: true,
  storyRate: 1,
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
}
