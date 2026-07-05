import { useState } from "react";
import { ensurePeriodicSync } from "../lib/reminders";
import { useSettings, THEMES, STORY_RATES } from "./useSettings";
import { Toggle } from "./kit/Toggle";
import { SegmentedControl } from "./kit/SegmentedControl";
import { SectionLabel } from "./kit/SectionLabel";

const REMINDER_HOURS: { value: number; label: string }[] = [
  { value: 9, label: "Matin" },
  { value: 13, label: "Midi" },
  { value: 19, label: "Soir" },
];

interface Props {
  /** Mode compact du tiroir latéral : masque la section Révision (réglages avancés)
   * et étire les bascules sur la largeur. La page « Tous les paramètres » affiche tout. */
  quick?: boolean;
}

/** Contenu des réglages, partagé entre la page Settings et le tiroir SettingsPanel —
 * mêmes libellés et mêmes sections partout, une seule source. */
export function SettingsSections({ quick }: Props) {
  const { settings, update } = useSettings();
  const [reminderError, setReminderError] = useState<string | null>(null);

  async function toggleReminders(enabled: boolean) {
    setReminderError(null);
    if (enabled) {
      if (typeof Notification === "undefined") {
        setReminderError("Les notifications ne sont pas disponibles dans ce navigateur.");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setReminderError("Autorisation refusée par le navigateur — rappels impossibles.");
        return;
      }
    }
    update({ reminders: { ...settings.reminders, enabled } });
    void ensurePeriodicSync(enabled);
  }

  return (
    <div className={`flex flex-col ${quick ? "gap-6" : "gap-8"}`}>
      <section>
        <SectionLabel as="h3" className="mb-3">Affichage</SectionLabel>
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
          <Toggle
            label="Masquer gloss et furigana des mots connus"
            value={settings.glossHideKnown}
            onChange={(v) => update({ glossHideKnown: v })}
          />
        </div>
      </section>

      <section>
        <SectionLabel as="h3" className="mb-3">Lecture audio</SectionLabel>
        <div
          className={
            quick ? "flex flex-col gap-2" : "flex items-center justify-between gap-4"
          }
        >
          <span className="text-sm text-text">Vitesse des histoires</span>
          <SegmentedControl
            fullWidth={quick}
            options={STORY_RATES.map((r) => ({ value: r.value, label: r.label }))}
            value={settings.storyRate}
            onChange={(v) => update({ storyRate: v })}
            ariaLabel="Vitesse de lecture des histoires"
          />
        </div>
      </section>

      {!quick && (
        <section>
          <SectionLabel as="h3" className="mb-3">Révision</SectionLabel>
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
      )}

      {!quick && (
        <section>
          <SectionLabel as="h3" className="mb-3">Rappels</SectionLabel>
          <div className="flex flex-col gap-3">
            <Toggle
              label="Me rappeler mes révisions"
              value={settings.reminders.enabled}
              onChange={(v) => void toggleReminders(v)}
            />
            {reminderError && <p className="m-0 text-sm text-accent">{reminderError}</p>}
            {settings.reminders.enabled && (
              <SegmentedControl
                options={REMINDER_HOURS}
                value={settings.reminders.hour}
                onChange={(v) => update({ reminders: { ...settings.reminders, hour: v } })}
                ariaLabel="Heure du rappel"
              />
            )}
            <p className="m-0 text-xs leading-relaxed text-muted">
              Notification locale quand des révisions t'attendent, au mieux des capacités du
              navigateur (app installée sur Android recommandée). Aucune donnée ne quitte
              l'appareil.
            </p>
          </div>
        </section>
      )}

      <section>
        <SectionLabel as="h3" className="mb-3">Thème</SectionLabel>
        <SegmentedControl
          fullWidth={quick}
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
        className="h-11 w-20 rounded-sm border border-hairline-strong bg-surface px-2 text-right text-sm text-text"
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n) && n >= min) onChange(n);
        }}
      />
    </div>
  );
}
