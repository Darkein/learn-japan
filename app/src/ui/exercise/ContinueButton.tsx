import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";

interface Props {
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

/**
 * Suite d'une réponse CORRECTE : un seul bouton, noté "good" d'office.
 *
 * Il y avait là une auto-évaluation à trois branches (Difficile/Bien/Facile). Elle
 * demandait à l'apprenant de juger sa propre mémoire au moment le plus mauvais pour ça —
 * juste après avoir vu la réponse, quand tout paraît évident. Et elle ne servait à rien
 * qu'un échec ne dise mieux : un mot mal su se rate au passage suivant, et c'est FSRS qui
 * en tire les conséquences. Trois clics à peser remplacés par un seul à faire.
 *
 * "good" et non "easy" : sans auto-évaluation, la note d'office s'applique à TOUTES les
 * réussites, y compris celles arrachées de justesse. "easy" les traiterait toutes comme
 * des évidences et ferait exploser les intervalles (10 j dès la première réussite, plus
 * d'un an au troisième passage) ; le mot ne revient alors qu'une fois complètement oublié.
 * "good" garde la montée mesurée de FSRS : 0 → 2 → 11 → 47 j.
 */
export function ContinueButton({ onGraded, onNext }: Props) {
  return (
    <Button
      variant="primary"
      onClick={() => {
        onGraded("good");
        onNext();
      }}
    >
      Continuer
    </Button>
  );
}
