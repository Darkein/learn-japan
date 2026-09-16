import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";

interface Props {
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

/**
 * Suite d'une réponse CORRECTE : un seul bouton, noté "easy" d'office.
 *
 * Il y avait là une auto-évaluation à trois branches (Difficile/Bien/Facile). Elle
 * demandait à l'apprenant de juger sa propre mémoire au moment le plus mauvais pour ça —
 * juste après avoir vu la réponse, quand tout paraît évident. Et elle ne servait à rien
 * qu'un échec ne dise mieux : un mot mal su se rate au passage suivant, et c'est FSRS qui
 * en tire les conséquences. Trois clics à peser remplacés par un seul à faire.
 *
 * "easy" plutôt que "good" : la carte bascule dans l'état Review (donc compte pour le
 * déblocage et la maîtrise) dès la première réussite, là où "good" exige deux passages
 * espacés de 10 min — un aller-retour de plus dans la session pour une réponse déjà juste.
 */
export function ContinueButton({ onGraded, onNext }: Props) {
  return (
    <Button
      variant="primary"
      onClick={() => {
        onGraded("easy");
        onNext();
      }}
    >
      Continuer
    </Button>
  );
}
