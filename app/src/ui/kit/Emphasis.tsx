// Rend l'emphase Markdown minimale des textes générés (mnémos) : **gras** → <strong>,
// *italique* → <em>. Pas de vrai parseur Markdown : les corpus n'utilisent que ça.

const EMPHASIS = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;

export function Emphasis({ text }: { text: string }) {
  return (
    <>
      {text.split(EMPHASIS).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return part;
      })}
    </>
  );
}
