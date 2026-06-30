// Barre de progression (estimée) d'une génération en cours. Un libellé d'étape + un
// pourcentage + un filet d'accent qui se remplit. L'avancement est une estimation (un appel
// LLM ne remonte pas de progression réelle) : voir lib/genJobs.ts.

export function GenProgress({ label, progress }: { label: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 text-sm text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
