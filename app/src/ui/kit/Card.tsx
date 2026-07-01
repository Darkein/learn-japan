import type { HTMLAttributes } from "react";

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Variante « fanion » : filet gauche épais accent (mise en avant, DESIGN.md §6). */
  accentFlag?: boolean;
}

/** Panneau sur-mesure : filet fin + fond surface, jamais d'ombre ni de coin très arrondi. */
export function Card({ accentFlag, className = "", ...rest }: Props) {
  const base = "rounded-sm border border-hairline bg-surface p-4";
  const flag = accentFlag ? "rounded-r-sm border-l-4 border-l-accent" : "";
  return <div className={[base, flag, className].filter(Boolean).join(" ")} {...rest} />;
}
