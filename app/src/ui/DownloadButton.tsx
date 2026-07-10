// Bouton icône unique du mode hors-ligne (sans texte) : montre l'état d'un coup d'œil et
// déclenche le téléchargement en un clic. Présent sur les cartes de leçon, les lignes
// d'histoire et les en-têtes de lecture — même composant partout, même registre derrière.

import type { MouseEvent } from "react";
import { Button } from "./kit/Button";
import { IconDownload, IconDownloadDone } from "./kit/Icon";
import { useDownload, type DownloadTarget } from "./useDownloads";

interface Props {
  target: DownloadTarget;
  /** Taille de l'icône : 16 dans les listes, 20 (défaut) dans les en-têtes. */
  size?: number;
}

/** Anneau de progression, style du kit (viewBox 24, trait 1.5, currentColor). */
function ProgressRing({ fraction, size, indeterminate }: { fraction: number; size: number; indeterminate?: boolean }) {
  const C = 2 * Math.PI * 10; // r = 10
  const shown = indeterminate ? 0.25 : Math.max(0.02, fraction);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={indeterminate ? "animate-spin" : ""}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - shown)}
        transform="rotate(-90 12 12)"
        className="text-accent"
      />
    </svg>
  );
}

export function DownloadButton({ target, size = 20 }: Props) {
  const { view, start, cancel } = useDownload(target);
  const pct = Math.round(view.fraction * 100);

  const what = target.kind === "lesson" ? "la leçon" : "l'histoire";
  const label =
    view.status === "none"
      ? `Télécharger ${what} pour lire hors-ligne`
      : view.status === "queued"
        ? "En attente de téléchargement — cliquer pour annuler"
        : view.status === "downloading"
          ? `Téléchargement… ${pct} % — ${view.label}`
          : view.status === "done"
            ? "Téléchargée — disponible hors-ligne"
            : `Échec du téléchargement — cliquer pour réessayer${view.error ? ` (${view.error})` : ""}`;

  function onClick(e: MouseEvent) {
    // Le bouton vit dans des lignes/cartes cliquables : ne pas ouvrir l'élément.
    e.stopPropagation();
    if (view.status === "none" || view.status === "error") start();
    else if (view.status === "queued") cancel();
  }

  return (
    <Button size="icon" variant="quiet" aria-label={label} title={label} onClick={onClick}>
      {view.status === "queued" ? (
        <ProgressRing fraction={0} size={size} indeterminate />
      ) : view.status === "downloading" ? (
        <ProgressRing fraction={view.fraction} size={size} />
      ) : view.status === "done" ? (
        <span className="text-accent">
          <IconDownloadDone size={size} />
        </span>
      ) : view.status === "error" ? (
        <span className="text-accent">
          <IconDownload size={size} />
        </span>
      ) : (
        <IconDownload size={size} />
      )}
    </Button>
  );
}
