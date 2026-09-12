// Bouton « Réinitialiser » d'un élément difficile : cartes FSRS neuves + jalon dans le log
// de révisions (lib/leech.ts) — sans ce jalon, les échecs déjà journalisés le garderaient
// « difficile » pour toujours et le bouton semblerait sans effet. Posé là où l'élément se
// consulte : fiche du mot (Catalogue, lecteur) et rangée de grammaire du Catalogue.

import { useState } from "react";
import { resetItemProgress, type Track } from "../lib/leech";
import { Button } from "./kit/Button";

export function ResetProgressButton({
  track,
  id,
  onDone,
  className = "",
}: {
  track: Track;
  id: string;
  /** Appelé après la remise à zéro : l'hôte recharge ses listes (badge, filtre). */
  onDone?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await resetItemProgress(track, id);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      className={`shrink-0 ${className}`}
      onClick={() => void run()}
    >
      {busy ? "…" : "Réinitialiser"}
    </Button>
  );
}
