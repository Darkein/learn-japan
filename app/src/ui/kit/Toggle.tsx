interface Props {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

/** Interrupteur `role="switch"` — était dupliqué à l'identique dans Settings et SettingsPanel. */
export function Toggle({ label, value, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        className="min-h-11 min-w-11 cursor-pointer rounded-sm border border-hairline px-3 text-xs tracking-wide text-muted transition-colors aria-checked:border-accent aria-checked:text-accent"
        onClick={() => onChange(!value)}
      >
        {value ? "Activé" : "Désactivé"}
      </button>
    </div>
  );
}
