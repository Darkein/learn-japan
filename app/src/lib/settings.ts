import { SRS } from "./config";

export type Theme = "system" | "dark" | "light";

export interface AppSettings {
  furiganaDefault: boolean;
  glossDefault: boolean;
  dailyGoal: number;
  newPerDay: number;
  theme: Theme;
  warmupRomaji: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  furiganaDefault: false,
  glossDefault: true,
  dailyGoal: SRS.dailyGoal,
  newPerDay: SRS.newPerDay,
  theme: "system",
  warmupRomaji: true,
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
