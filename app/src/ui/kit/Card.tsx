import type { HTMLAttributes } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Variante « fanion » : filet gauche épais accent (mise en avant, DESIGN.md §6). */
  accentFlag?: boolean;
}

/** Panneau sur-mesure : filet fin + fond surface + élévation `--elev` (l'unique ombre
 * autorisée, DESIGN.md §2) pour détacher le bloc du fond. */
export function Card({ accentFlag, className = "", ...rest }: Props) {
  const base = "rounded-md border border-hairline bg-surface p-4 shadow-elev";
  const flag = accentFlag ? "rounded-r-md border-l-4 border-l-accent" : "";
  return <div className={[base, flag, className].filter(Boolean).join(" ")} {...rest} />;
}
