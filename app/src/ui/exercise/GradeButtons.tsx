import type { SrsGrade } from "../../lib/srs";
import { Button } from "../kit/Button";

interface Props {
  onGraded: (grade: SrsGrade) => void;
  onNext: () => void;
}

const GRADES: { grade: SrsGrade; label: string }[] = [
  { grade: "hard", label: "Difficile" },
  { grade: "good", label: "Bien" },
  { grade: "easy", label: "Facile" },
];

/**
 * Auto-évaluation après une réponse correcte : Difficile/Bien/Facile (FSRS
 * hard/good/easy). "Difficile" raccourcit l'intervalle sans compter comme un échec —
 * pour les réponses trouvées avec hésitation.
 */
export function GradeButtons({ onGraded, onNext }: Props) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {GRADES.map(({ grade, label }) => (
        <Button
          key={grade}
          variant="ghost"
          className="grow basis-20"
          onClick={() => {
            onGraded(grade);
            onNext();
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
