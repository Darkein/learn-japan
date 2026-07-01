import type { ReactNode } from "react";
import type { Tab } from "./useHashRoute";

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V9.5l8-5.5 8 5.5V19" />
      <path d="M4 19h16" />
      <path d="M9.5 19v-6h5v6" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5C4 4.67 4.67 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

const ICONS: Record<Tab, ReactNode> = {
  home: <IconHome />,
  stories: <IconBook />,
  catalogue: <IconGrid />,
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
          <span className="font-sans text-[0.65rem] tracking-wide">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
