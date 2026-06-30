import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadSettings,
  saveSettings,
  type AppSettings,
  type Theme,
} from "../lib/settings";

export type { AppSettings, Theme };

export const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "Auto" },
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
];

interface SettingsApi {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const api = useMemo<SettingsApi>(
    () => ({ settings, update, panelOpen, openPanel, closePanel }),
    [settings, update, panelOpen, openPanel, closePanel],
  );

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings doit être utilisé dans un <SettingsProvider>");
  return ctx;
}
