import type { ReactNode } from "react";
import type { Tab } from "./useHashRoute";
import { IconBook, IconGrid, IconHome } from "./kit/Icon";

const ICONS: Record<Tab, ReactNode> = {
  home: <IconHome size={22} />,
  stories: <IconBook size={22} />,
  catalogue: <IconGrid size={22} />,
};

interface Props {
  tabs: { id: Tab; label: string; path: string }[];
  active: Tab;
  onNavigate: (path: string) => void;
}

/** Hauteur du contenu de la barre (hors safe-area) — utilisée aussi par PodcastPlayer pour se décaler. */
export const BOTTOM_NAV_HEIGHT = "3.5rem";

/** Barre d'onglets fixée en bas, atteignable au pouce (DESIGN.md §7 : cibles ≥44px). Ne
 * remplace la nav du haut que sur les 3 onglets principaux — les sous-pages gardent le
 * fil « ← Retour » de ReaderPage. */
export function BottomNav({ tabs, active, onNavigate }: Props) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-surface"
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-muted aria-[current=true]:text-accent"
          style={{ minHeight: BOTTOM_NAV_HEIGHT }}
          aria-current={active === t.id}
          onClick={() => onNavigate(t.path)}
        >
          {ICONS[t.id]}
          <span className="font-sans text-xs tracking-wide">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
