import { grammarDetail } from "../lib/inventory";
import type { Lesson } from "../lib/lessons";
import { Card } from "./kit/Card";
import { SectionLabel } from "./kit/SectionLabel";

/**
 * Ce que la leçon ENSEIGNE, en clair : ses points de grammaire (règle + exemple) et son
 * vocabulaire (graphie, lecture, sens). C'est la matière du cours — celle que le contrôle
 * interrogera —, et elle vient de l'inventaire, jamais d'une génération : elle est là même
 * quand le cadrage Markdown manque (hors-ligne, leçon non générée).
 *
 * Servie AUX DEUX ENDROITS où la leçon se lit : sa page (ui/CourseDetail.tsx) et le bloc
 * « Leçon » du flux (ui/FlowSession.tsx). Le flux n'affichait que le cadrage : on y
 * découvrait les mots dans les exercices, sans les avoir jamais vus posés.
 *
 * Rien à afficher (leçon sans objectifs) ⇒ rien du tout, pas une carte vide.
 */
export function LessonObjectives({ lesson }: { lesson: Lesson }) {
  const grammar = lesson.introduces.grammar.map(grammarDetail).filter((g) => g !== null);
  const vocab = lesson.objectives.vocab;
  if (grammar.length === 0 && vocab.length === 0) return null;

  return (
    <Card className="flex flex-col gap-4">
      {grammar.length > 0 && (
        <div>
          <SectionLabel as="p" className="mb-2">Grammaire</SectionLabel>
          <ul className="flex list-none flex-col gap-1">
            {grammar.map((g) => (
              <li
                key={g.id}
                className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[6rem_1fr] sm:items-baseline sm:gap-3"
              >
                <span className="font-jp text-sm text-text">{g.name}</span>
                <span className="font-sans text-sm text-text">
                  {g.ruleFr} <em>ex. {g.exampleJa}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {vocab.length > 0 && (
        <div>
          <SectionLabel as="p" className="mb-2">Vocabulaire</SectionLabel>
          <ul className="flex list-none flex-col gap-1">
            {vocab.map((v) => (
              <li key={v.ja} className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
                <span className="font-jp text-sm text-text">
                  {v.ja}
                  {v.yomi && v.yomi !== v.ja && (
                    <span className="ml-2 font-jp text-sm italic text-muted">{v.yomi}</span>
                  )}
                </span>
                <span className="font-sans text-sm text-text">{v.fr}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
