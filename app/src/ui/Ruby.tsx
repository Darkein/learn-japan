import type { RubySegment } from "../lib/furigana";

/** Rend des segments en <ruby> ; les furigana sont masqués tant que `reveal` est faux. */
export function Ruby({ segments, reveal }: { segments: RubySegment[]; reveal: boolean }) {
  return (
    <>
      {segments.map((s, i) =>
        s.ruby ? (
          <ruby key={i}>
            {s.base}
            <rt style={{ visibility: reveal ? "visible" : "hidden" }}>{s.ruby}</rt>
          </ruby>
        ) : (
          <span key={i}>{s.base}</span>
        ),
      )}
    </>
  );
}
