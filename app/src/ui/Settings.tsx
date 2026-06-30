import { useSettings, THEMES } from "./useSettings";

export function Settings() {
  const { settings, update } = useSettings();

  return (
    <div className="flex flex-col gap-8">
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
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Révision</h3>
        <div className="flex flex-col gap-4">
          <NumberRow
            label="Objectif quotidien (cartes)"
            value={settings.dailyGoal}
            min={1}
            onChange={(v) => update({ dailyGoal: v })}
          />
          <NumberRow
            label="Nouveaux mots par jour"
            value={settings.newPerDay}
            min={1}
            onChange={(v) => update({ newPerDay: v })}
          />
          <ToggleRow
            label="Romaji → kana dans les révisions"
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

function NumberRow({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        className="w-20 rounded-sm border border-hairline bg-surface px-2 py-1 text-right text-sm text-text"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= min) onChange(n);
        }}
      />
    </div>
  );
}
