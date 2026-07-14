import { useEffect, useId, useState } from "react";

// Écran de chargement plein écran, réutilisé par toutes les vues en attente de données
// (Accueil, Stats, Voyage, Catalogue, Histoires, révisions, ouverture d'une leçon/histoire).
// Un ensō (円相) peint d'un coup de pinceau — même vocabulaire visuel que le trait d'encre de
// StationArrival (cf. global.css, DESIGN.md §2 : sobre, un seul accent). La forme n'est pas
// un cercle net mais une bande à épaisseur variable, révélée par un masque qui balaie sa
// ligne centrale, avec le grain d'un pinceau sec (filtre de turbulence).
//
// Anti-clignotement : la donnée arrive souvent en quelques dizaines de ms. On réserve la
// place tout de suite (min-h) mais on ne peint l'ensō qu'après un court délai — un
// chargement quasi instantané ne montre alors rien, et au-delà l'encre apparaît en fondu.

// Tracé de la bande (bord externe aller, bord interne retour) — généré, cf. genpath.mjs.
const BRUSH =
  "M12.07,44.46L11.44,43.67L10.48,43.04L9.41,42.41L8.34,41.72L7.37,40.92L6.63,40.00L6.22,38.94L6.04,37.83L5.94,36.71L5.90,35.59L5.92,34.47L5.99,33.36L6.09,32.26L6.22,31.17L6.36,30.09L6.51,29.02L6.68,27.95L6.86,26.88L7.06,25.81L7.28,24.75L7.54,23.69L7.84,22.64L8.20,21.60L8.62,20.59L9.11,19.61L9.66,18.66L10.29,17.76L10.99,16.91L11.74,16.12L12.55,15.38L13.41,14.70L14.29,14.07L15.20,13.49L16.11,12.94L17.03,12.42L17.95,11.92L18.87,11.43L19.77,10.95L20.68,10.46L21.58,9.97L22.49,9.49L23.42,9.01L24.35,8.54L25.31,8.10L26.29,7.69L27.29,7.33L28.32,7.03L29.36,6.79L30.42,6.62L31.49,6.53L32.57,6.52L33.64,6.58L34.71,6.71L35.76,6.91L36.80,7.17L37.83,7.47L38.84,7.81L39.83,8.18L40.82,8.57L41.79,8.99L42.75,9.42L43.70,9.87L44.64,10.35L45.58,10.85L46.50,11.39L47.40,11.96L48.28,12.57L49.13,13.23L49.94,13.93L50.70,14.69L51.42,15.49L52.09,16.33L52.70,17.21L53.26,18.13L53.76,19.07L54.22,20.04L54.63,21.03L54.99,22.03L55.32,23.03L55.61,24.04L55.88,25.06L56.12,26.08L56.33,27.11L56.52,28.14L56.67,29.17L56.80,30.22L56.88,31.26L56.93,32.31L56.94,33.37L56.90,34.42L56.81,35.47L56.67,36.52L56.48,37.56L56.25,38.60L55.97,39.62L55.66,40.64L55.30,41.64L54.92,42.63L54.50,43.62L54.05,44.59L53.57,45.56L53.07,46.51L52.52,47.45L51.94,48.38L51.33,49.29L50.66,50.17L49.96,51.02L49.20,51.83L48.40,52.60L47.55,53.32L46.65,53.98L45.71,54.57L44.72,55.09L43.70,55.53L42.64,55.89L41.57,56.19L40.49,56.42L39.41,56.59L38.32,56.71L37.23,56.78L36.16,56.81L35.09,56.80L34.02,56.75L32.97,56.67L31.93,56.56L30.90,56.41L29.88,56.22L28.88,56.00L27.89,55.73L26.92,55.42L25.96,55.07L25.04,54.67L24.13,54.22L23.26,53.73L22.40,53.22L21.56,52.71L20.76,52.14L19.99,51.54L19.25,50.90L19.42,50.65L20.15,51.28L20.91,51.88L21.70,52.44L22.53,52.95L23.41,53.36L24.33,53.67L25.27,53.91L26.23,54.06L27.19,54.15L28.16,54.17L29.12,54.13L30.07,54.05L31.01,53.93L31.94,53.80L32.85,53.64L33.76,53.48L34.65,53.30L35.54,53.12L36.42,52.92L37.29,52.70L38.16,52.44L39.01,52.15L39.84,51.81L40.65,51.42L41.43,50.97L42.18,50.47L42.88,49.93L43.56,49.34L44.18,48.71L44.76,48.03L45.30,47.33L45.80,46.62L46.27,45.89L46.72,45.17L47.16,44.45L47.59,43.74L48.02,43.04L48.47,42.35L48.92,41.66L49.37,40.97L49.83,40.27L50.28,39.56L50.71,38.83L51.12,38.08L51.48,37.30L51.80,36.50L52.06,35.68L52.25,34.84L52.38,33.98L52.44,33.12L52.43,32.26L52.36,31.40L52.25,30.54L52.09,29.70L51.91,28.86L51.71,28.04L51.50,27.22L51.29,26.39L51.09,25.57L50.88,24.74L50.68,23.90L50.47,23.04L50.24,22.18L50.00,21.31L49.72,20.44L49.39,19.58L49.01,18.73L48.58,17.91L48.08,17.12L47.51,16.38L46.88,15.69L46.20,15.06L45.46,14.49L44.67,13.98L43.85,13.54L43.01,13.15L42.15,12.81L41.27,12.52L40.39,12.26L39.51,12.03L38.64,11.82L37.76,11.63L36.88,11.45L36.01,11.29L35.13,11.15L34.25,11.03L33.36,10.95L32.47,10.90L31.58,10.89L30.69,10.94L29.81,11.04L28.93,11.20L28.07,11.41L27.23,11.68L26.40,12.01L25.60,12.38L24.83,12.79L24.08,13.23L23.35,13.70L22.64,14.20L21.95,14.70L21.28,15.21L20.62,15.74L19.97,16.27L19.33,16.81L18.71,17.35L18.09,17.92L17.48,18.49L16.90,19.09L16.33,19.71L15.79,20.36L15.27,21.03L14.79,21.72L14.34,22.44L13.93,23.18L13.55,23.94L13.21,24.72L12.90,25.51L12.61,26.31L12.36,27.13L12.13,27.95L11.93,28.79L11.75,29.63L11.59,30.48L11.47,31.34L11.38,32.21L11.33,33.08L11.32,33.96L11.35,34.84L11.44,35.72L11.59,36.59L11.79,37.45L11.91,38.33L11.83,39.31L11.67,40.35L11.53,41.43L11.52,42.51L11.72,43.52L12.32,44.30Z";
// Ligne centrale, stroke-masquée pour révéler la bande au fil du « geste ».
const CENTER =
  "M12.19,44.38L11.58,43.59L11.00,42.78L10.47,41.92L10.00,41.04L9.60,40.11L9.27,39.17L9.01,38.20L8.81,37.21L8.69,36.21L8.63,35.21L8.62,34.21L8.66,33.22L8.73,32.23L8.84,31.26L8.98,30.29L9.13,29.32L9.30,28.37L9.50,27.42L9.71,26.47L9.95,25.53L10.22,24.60L10.53,23.68L10.88,22.77L11.28,21.89L11.72,21.02L12.23,20.19L12.78,19.39L13.39,18.63L14.04,17.91L14.72,17.24L15.44,16.60L16.19,15.99L16.95,15.42L17.72,14.87L18.50,14.34L19.29,13.83L20.07,13.32L20.86,12.82L21.66,12.33L22.47,11.84L23.29,11.36L24.12,10.90L24.98,10.46L25.86,10.05L26.76,9.69L27.68,9.37L28.62,9.11L29.59,8.91L30.56,8.78L31.54,8.71L32.52,8.71L33.50,8.76L34.48,8.87L35.45,9.03L36.41,9.23L37.36,9.46L38.30,9.72L39.24,10.00L40.17,10.30L41.09,10.62L42.01,10.97L42.92,11.34L43.83,11.75L44.72,12.20L45.59,12.69L46.43,13.22L47.24,13.81L48.00,14.46L48.72,15.15L49.39,15.90L50.00,16.70L50.55,17.53L51.05,18.39L51.49,19.29L51.88,20.19L52.23,21.11L52.55,22.04L52.83,22.96L53.10,23.88L53.35,24.81L53.59,25.73L53.81,26.65L54.02,27.57L54.21,28.50L54.38,29.44L54.52,30.38L54.62,31.33L54.68,32.28L54.69,33.24L54.64,34.20L54.53,35.15L54.36,36.10L54.14,37.03L53.87,37.95L53.55,38.85L53.18,39.73L52.79,40.60L52.37,41.45L51.94,42.29L51.48,43.13L51.02,43.95L50.54,44.77L50.06,45.60L49.55,46.41L49.02,47.23L48.47,48.03L47.88,48.82L47.25,49.58L46.58,50.32L45.86,51.01L45.10,51.66L44.30,52.25L43.45,52.78L42.56,53.25L41.65,53.65L40.71,54.00L39.75,54.28L38.78,54.51L37.81,54.70L36.83,54.85L35.85,54.96L34.87,55.05L33.89,55.11L32.91,55.16L31.94,55.18L30.96,55.17L29.98,55.13L29.00,55.06L28.02,54.95L27.06,54.78L26.10,54.57L25.15,54.29L24.23,53.95L23.33,53.55L22.47,53.09L21.63,52.57L20.83,52.01L20.07,51.41L19.34,50.77";

interface Props {
  /** Libellé sous l'ensō. Par défaut « Chargement… ». */
  label?: string;
  /** Classes en plus (rare — ajuster la hauteur mini par ex.). */
  className?: string;
}

export function LoadingScreen({ label = "Chargement…", className = "" }: Props) {
  // Ids uniques par instance : filtre/masque SVG sont globaux au document.
  const uid = useId().replace(/:/g, "");
  const maskId = `enso-mask-${uid}`;
  const inkId = `enso-ink-${uid}`;

  // Délai anti-flash : on ne peint qu'au-delà d'un court instant (cf. en-tête).
  const [painting, setPainting] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPainting(true), 170);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className={`flex min-h-[70dvh] flex-col items-center justify-center gap-5 text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      {painting && (
        <>
          <span className="enso-appear inline-flex">
            <svg className="enso-sway" width="84" height="84" viewBox="0 0 64 64" aria-hidden="true">
              <defs>
                {/* Grain de pinceau sec : les bords tremblent légèrement (pas un vecteur net). */}
                <filter id={inkId} x="-15%" y="-15%" width="130%" height="130%">
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.9"
                    numOctaves="2"
                    seed="7"
                    result="noise"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="noise"
                    scale="1.8"
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </filter>
                {/* Le masque suit la ligne centrale et se dévoile (stroke-dashoffset animé). */}
                <mask id={maskId}>
                  <path
                    className="enso-reveal"
                    d={CENTER}
                    fill="none"
                    stroke="#fff"
                    strokeWidth="11"
                    strokeLinecap="round"
                    pathLength="1"
                  />
                </mask>
              </defs>
              <path d={BRUSH} fill="var(--accent)" filter={`url(#${inkId})`} mask={`url(#${maskId})`} />
            </svg>
          </span>
          <p className="enso-appear font-sans text-sm tracking-wide text-muted">{label}</p>
        </>
      )}
    </div>
  );
}
