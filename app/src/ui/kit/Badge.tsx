import type { HTMLAttributes } from "react";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** `default` = filet neutre ; `accent` = filet + texte accent (mise en avant, ex. leçon liée). */
  variant?: "default" | "accent";
}

/** Étiquette courte (statut, niveau, tag) — filet fin, pas de fond plein. */
export function Badge({ variant = "default", className = "", ...rest }: Props) {
  const variantCls = variant === "accent" ? "border-accent text-accent" : "border-hairline text-muted";
  return <span className={`rounded-sm border px-2 py-0.5 text-xs ${variantCls} ${className}`} {...rest} />;
}
