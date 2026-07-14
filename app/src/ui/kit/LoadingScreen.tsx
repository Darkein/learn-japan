// Écran de chargement plein écran, réutilisé par toutes les vues en attente de données
// (Accueil, Stats, Voyage, Catalogue, Histoires, révisions, ouverture d'une leçon/histoire).
// Remplace le discret « Chargement… » par un ensō (円相) qui se peint au pinceau — même
// vocabulaire visuel que le trait d'encre de StationArrival (cf. global.css, DESIGN.md §2 :
// sobre, un seul accent, aucun clinquant). Occupe la hauteur du viewport sur mobile pour
// centrer l'attente au lieu de laisser une ligne perdue en haut de page.

interface Props {
  /** Libellé sous l'ensō. Par défaut « Chargement… ». */
  label?: string;
  /** Classes en plus (rare — ajuster la hauteur mini par ex.). */
  className?: string;
}

export function LoadingScreen({ label = "Chargement…", className = "" }: Props) {
  return (
    <div
      className={`flex min-h-[70dvh] flex-col items-center justify-center gap-5 text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="enso-sway inline-flex">
        <svg width="76" height="76" viewBox="0 0 64 64" aria-hidden="true">
          {/* Empreinte pâle du papier, sous le trait d'encre. */}
          <circle cx="32" cy="32" r="26" fill="none" stroke="var(--hairline)" strokeWidth="2" />
          {/* Le trait d'encre qui se peint en boucle (animation dans global.css). */}
          <circle
            className="enso-stroke"
            cx="32"
            cy="32"
            r="26"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3.5"
            strokeLinecap="round"
            pathLength="1"
          />
        </svg>
      </span>
      <p className="font-sans text-sm tracking-wide text-muted">{label}</p>
    </div>
  );
}
