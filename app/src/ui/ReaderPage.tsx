import type { ReactNode } from "react";
import styles from "./ReaderPage.module.css";

interface Props {
  /** Titre optionnel affiché dans la barre supérieure (titre de la leçon / histoire). */
  title?: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * Page dédiée vers laquelle on navigue (lecture, révision) : remplace le shell à
 * onglets par une vue épurée avec une barre fine « ← Retour » + titre. Objectif :
 * navigation simple, page lisible (cf. DESIGN.md — filets, un seul accent).
 */
export function ReaderPage({ title, onBack, children }: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <button className={styles.back} onClick={onBack}>
          ← Retour
        </button>
        {title && <span className={styles.title}>{title}</span>}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
