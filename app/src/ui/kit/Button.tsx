import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` = aplat accent (action principale) ; `ghost` = filet (défaut). */
  variant?: "primary" | "ghost";
  /** `md` (défaut) = cible tactile ≥44px ; `sm` = usage compact (listes denses, contrôles secondaires). */
  size?: "md" | "sm";
  fullWidth?: boolean;
}

/** Bouton sur-mesure (DESIGN.md §6) : texte + filet par défaut, aplat accent en primaire,
 * jamais d'ombre ni de dégradé. Remplace le pattern Tailwind dupliqué dans une dizaine d'écrans. */
export function Button({
  variant = "ghost",
  size = "md",
  fullWidth,
  className = "",
  ...rest
}: Props) {
  const base =
    "cursor-pointer inline-flex items-center justify-center gap-2 rounded-sm font-sans transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizeCls = size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-xs";
  const variantCls =
    variant === "primary"
      ? "border border-accent bg-accent text-white hover:bg-accent/90"
      : "border border-hairline text-text hover:border-accent";
  return (
    <button
      className={[base, sizeCls, variantCls, fullWidth ? "w-full" : "", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
