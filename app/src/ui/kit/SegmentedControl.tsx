interface Option<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Étire les segments pour occuper toute la largeur (ex. réglages) ; sinon largeur au contenu (ex. filtres catalogue). */
  fullWidth?: boolean;
  className?: string;
}

/** Groupe de bascules (filtres, réglages) — filet fin, segment actif en `surface-2`. */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth,
  className = "",
}: Props<T>) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-sm border border-hairline ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          className={`min-h-11 cursor-pointer border-l border-hairline px-3 text-xs tracking-wide text-muted first:border-l-0 aria-pressed:bg-surface-2 aria-pressed:text-text ${fullWidth ? "flex-1" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
