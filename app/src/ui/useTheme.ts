import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "dark" | "light";

/** Thème : sombre par défaut, suit le système, override manuel persistant (DESIGN.md §3). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, [theme]);

  const set = useCallback((t: Theme) => setTheme(t), []);
  return [theme, set];
}
