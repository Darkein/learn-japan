interface Props {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

/**
 * Case à cocher façon sceau (hanko) : cerne d'encre à vide, pastille vermillon au coché,
 * coche-pinceau qui se dessine (ink-reveal, reduced-motion géré dans global.css).
 * Zone de tap 44px conservée, `role="switch"`.
 */
export function Toggle({ label, value, onChange }: Props) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text">{label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        className="group flex min-h-11 min-w-11 cursor-pointer items-center justify-center"
        onClick={() => onChange(!value)}
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border transition-colors ${
            value
              ? "border-accent bg-accent shadow-elev"
              : "border-hairline-strong bg-surface group-hover:border-accent"
          }`}
        >
          {value && (
            <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
              <path
                className="ink-reveal"
                pathLength={1}
                d="M3 7.8 5.8 10.4 11 3.8"
                fill="none"
                stroke="var(--color-on-accent)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
