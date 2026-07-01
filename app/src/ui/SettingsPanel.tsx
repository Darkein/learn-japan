import { currentLocation, navigate } from "./useHashRoute";
import { useSettings, THEMES, STORY_RATES } from "./useSettings";
import { Toggle } from "./kit/Toggle";
import { SegmentedControl } from "./kit/SegmentedControl";
import { Sheet } from "./kit/Sheet";

export function SettingsPanel() {
  const { settings, update, panelOpen, closePanel } = useSettings();

  return (
    <Sheet open={panelOpen} onClose={closePanel} variant="right" className="w-64">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <span className="font-sans text-sm font-medium text-text">Réglages</span>
        <button
          className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-lg leading-none text-muted hover:text-text"
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
            <Toggle
              label="Furigana"
              value={settings.furiganaDefault}
              onChange={(v) => update({ furiganaDefault: v })}
            />
            <Toggle
              label="Gloss"
              value={settings.glossDefault}
              onChange={(v) => update({ glossDefault: v })}
            />
            <Toggle
              label="Romaji"
              value={settings.warmupRomaji}
              onChange={(v) => update({ warmupRomaji: v })}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Lecture audio</h3>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-text">Vitesse des histoires</span>
            <SegmentedControl
              fullWidth
              options={STORY_RATES.map((r) => ({ value: r.value, label: r.label }))}
              value={settings.storyRate}
              onChange={(v) => update({ storyRate: v })}
              ariaLabel="Vitesse de lecture des histoires"
            />
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Thème</h3>
          <SegmentedControl
            fullWidth
            options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
            value={settings.theme}
            onChange={(v) => update({ theme: v })}
            ariaLabel="Thème"
          />
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
    </Sheet>
  );
}
