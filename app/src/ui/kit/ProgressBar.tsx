interface Props {
  /** Valeur 0–100. */
  value: number;
  className?: string;
  trackClassName?: string;
}

/** Barre de progression sur-mesure (DESIGN.md §6) : filet de fond + remplissage accent. */
export function ProgressBar({ value, className = "", trackClassName = "" }: Props) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-hairline ${trackClassName}`}>
      <div
        className={`h-full rounded-full bg-accent transition-[width] duration-500 ease-out ${className}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
