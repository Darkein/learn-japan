import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` = aplat accent (action principale, un seul par écran) ; `ghost` = fond surface +
   * filet fort (défaut) ; `quiet` = texte seul (tertiaire : liens d'action, fermeture). */
  variant?: "primary" | "ghost" | "quiet";
  /** `md` (défaut) = cible tactile ≥44px ; `sm` = usage compact ; `icon` = carré 44px sans padding. */
  size?: "md" | "sm" | "icon";
  fullWidth?: boolean;
  /** État « en cours » (ex. lecture audio active) : filet + texte accent. */
  active?: boolean;
}

/** Bouton sur-mesure (DESIGN.md §6) : ghost visible (surface + filet fort), aplat accent en
 * primaire, jamais d'ombre ni de dégradé. Remplace le pattern Tailwind dupliqué dans une dizaine d'écrans. */
export function Button({
  variant = "ghost",
  size = "md",
  fullWidth,
  active,
  className = "",
  ...rest
}: Props) {
  const base =
    "cursor-pointer inline-flex items-center justify-center gap-2 rounded-sm font-sans transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizeCls =
    size === "md"
      ? "min-h-11 px-4 text-sm"
      : size === "sm"
        ? "min-h-9 px-3 text-xs"
        : "min-h-11 min-w-11 px-0 text-sm";
  const variantCls =
    variant === "primary"
      ? "border border-accent bg-accent text-on-accent hover:bg-accent/90"
      : variant === "quiet"
        ? "border border-transparent text-muted hover:text-text"
        : active
          ? "border border-accent bg-surface text-accent hover:bg-surface-2"
          : "border border-hairline-strong bg-surface text-text hover:border-accent hover:bg-surface-2";
  return (
    <button
      className={[base, sizeCls, variantCls, fullWidth ? "w-full" : "", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
