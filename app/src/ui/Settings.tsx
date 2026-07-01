import { useSettings, THEMES, STORY_RATES } from "./useSettings";
import { Toggle } from "./kit/Toggle";
import { SegmentedControl } from "./kit/SegmentedControl";

export function Settings() {
  const { settings, update } = useSettings();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Affichage</h3>
        <div className="flex flex-col gap-3">
          <Toggle
            label="Furigana par défaut"
            value={settings.furiganaDefault}
            onChange={(v) => update({ furiganaDefault: v })}
          />
          <Toggle
            label="Gloss par défaut"
            value={settings.glossDefault}
            onChange={(v) => update({ glossDefault: v })}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Lecture audio</h3>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-text">Vitesse des histoires</span>
          <SegmentedControl
            options={STORY_RATES.map((r) => ({ value: r.value, label: r.label }))}
            value={settings.storyRate}
            onChange={(v) => update({ storyRate: v })}
            ariaLabel="Vitesse de lecture des histoires"
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
          <Toggle
            label="Romaji → kana dans les révisions"
            value={settings.warmupRomaji}
            onChange={(v) => update({ warmupRomaji: v })}
          />
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-sans text-xs uppercase tracking-widest text-muted">Thème</h3>
        <SegmentedControl
          options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
          value={settings.theme}
          onChange={(v) => update({ theme: v })}
          ariaLabel="Thème"
        />
      </section>
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
        className="h-11 w-20 rounded-sm border border-hairline bg-surface px-2 text-right text-sm text-text"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= min) onChange(n);
        }}
      />
    </div>
  );
}
