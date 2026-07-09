import type { RubySegment } from "../lib/furigana";

const NBSP = " ";

/** Rend des segments en <ruby> ; les furigana sont masqués tant que `reveal` est faux.
 * `reserve` (furigana activé) force chaque segment à réserver la boîte <rt> — même sans
 * furigana — pour que toutes les lignes aient la même hauteur. */
export function Ruby({
  segments,
  reveal,
  reserve = true,
}: {
  segments: RubySegment[];
  reveal: boolean;
  reserve?: boolean;
}) {
  if (!reserve) {
    return (
      <>
        {segments.map((s, i) => (
          <span key={i}>{s.base}</span>
        ))}
      </>
    );
  }
  return (
    <>
      {segments.map((s, i) => (
        <ruby key={i}>
          {s.base}
          <rt style={{ visibility: reveal && s.ruby ? "visible" : "hidden" }}>{s.ruby || NBSP}</rt>
        </ruby>
      ))}
    </>
  );
}
