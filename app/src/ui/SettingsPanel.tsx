import { useEffect } from "react";
import { currentLocation, navigate } from "./useHashRoute";
import { useSettings, THEMES } from "./useSettings";

export function SettingsPanel() {
  const { settings, update, panelOpen, closePanel } = useSettings();

  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={closePanel}
        aria-hidden="true"
      />
      <div
        className="relative ml-auto flex h-full w-full max-w-sm flex-col overflow-y-auto bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="font-sans text-sm font-medium text-text">Réglages</span>
          <button
            className="cursor-pointer px-1 text-lg leading-none text-muted hover:text-text"
            onClick={closePanel}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-6 px-4 py-4">
          <section>
            <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Affichage</h3>
            <div className="flex flex-col gap-3">
              <ToggleRow
                label="Furigana par défaut"
                value={settings.furiganaDefault}
                onChange={(v) => update({ furiganaDefault: v })}
              />
              <ToggleRow
                label="Gloss par défaut"
                value={settings.glossDefault}
                onChange={(v) => update({ glossDefault: v })}
              />
              <ToggleRow
                label="Romaji dans les révisions"
                value={settings.warmupRomaji}
                onChange={(v) => update({ warmupRomaji: v })}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Thème</h3>
            <div
              className="inline-flex overflow-hidden rounded-sm border border-hairline"
              role="group"
              aria-label="Thème"
            >
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className="cursor-pointer px-3 py-1 text-xs tracking-wide text-muted aria-pressed:bg-surface-2 aria-pressed:text-text"
                  aria-pressed={settings.theme === t.id}
                  onClick={() => update({ theme: t.id })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-auto border-t border-hairline px-4 py-3">
          <button
            className="cursor-pointer text-sm text-muted hover:text-text"
            onClick={() => {
              closePanel();
              navigate(`/parametres?from=${encodeURIComponent(currentLocation())}`);
            }}
          >
            Tous les paramètres →
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        className="cursor-pointer rounded-sm border px-3 py-1 text-xs tracking-wide transition-colors aria-checked:border-accent aria-checked:text-accent border-hairline text-muted"
        onClick={() => onChange(!value)}
      >
        {value ? "Activé" : "Désactivé"}
      </button>
    </div>
  );
}
