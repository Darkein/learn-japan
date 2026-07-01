import type { ElementType, HTMLAttributes, ReactNode } from "react";

interface Props extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children: ReactNode;
}

/** Libellé méta en petites capitales (DESIGN.md §2) : titres de section, badges de statut. */
export function SectionLabel({ as: Tag = "span", className = "", children, ...rest }: Props) {
  return (
    <Tag className={`font-sans text-xs uppercase tracking-widest text-muted ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
