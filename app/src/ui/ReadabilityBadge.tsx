import { useEffect, useState } from "react";
import { storyReadability, type Readability } from "../lib/readability";
import { Badge } from "./kit/Badge";

/**
 * Badge « lisible à N % » : part des mots de contenu de l'histoire déjà connus.
 * Calculé en différé (tokenizer + statuts SRS locaux) ; rien tant que ce n'est pas prêt.
 * ≥ 90 % = zone confortable de lecture extensive → mis en avant.
 */
export function ReadabilityBadge({ text }: { text: string }) {
  const [r, setR] = useState<Readability | null>(null);

  useEffect(() => {
    let cancelled = false;
    storyReadability(text)
      .then((res) => {
        if (!cancelled) setR(res);
      })
      .catch(() => {
        // Tokenizer indisponible : on n'affiche simplement pas le badge.
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!r || r.total === 0) return null;
  const pct = Math.round(r.coverage * 100);
  const seen = Math.round(((r.known + r.learning) / r.total) * 100);
  return (
    <Badge
      variant={pct >= 90 ? "accent" : "default"}
      title={`${r.known}/${r.total} mots connus · ${seen} % déjà rencontrés (connus + à revoir)`}
    >
      lisible à {pct} %
    </Badge>
  );
}
