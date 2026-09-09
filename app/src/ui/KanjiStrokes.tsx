// Ordre des traits d'un kanji : le caractère se dessine trait à trait, dans l'ordre
// d'écriture (KanjiVG, cf. lib/strokes.ts). Rendu dans la fiche kanji, au-dessus de la
// composition — on voit le caractère se construire, puis on lit de quoi il est fait.
//
// Le mouvement EST le contenu ici : sous prefers-reduced-motion la règle globale coupe
// l'animation, le caractère s'affiche entier (stroke-dashoffset 0 par défaut) et le bouton
// « Rejouer » reste la seule façon de la déclencher.

import { useEffect, useState } from "react";
import { kanjiStrokes, STROKES_VIEWBOX } from "../lib/strokes";

/** Durée d'un trait. 280 ms × 10 traits ≈ 3 s : on suit le geste sans s'endormir. */
const STROKE_MS = 280;
const SIZE = 112;

export function KanjiStrokes({ ch }: { ch: string }) {
  const [paths, setPaths] = useState<string[]>([]);
  // Compteur de relance : il sert de `key` au groupe, ce qui remonte les <path> et
  // redéclenche l'animation CSS (la remettre à zéro autrement demanderait un reflow forcé).
  const [run, setRun] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPaths([]);
    void kanjiStrokes(ch).then((p) => {
      if (!cancelled) {
        setPaths(p);
        setRun((n) => n + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ch]);

  if (paths.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wider text-muted">Tracé</p>
      <div className="flex items-center gap-3">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${STROKES_VIEWBOX} ${STROKES_VIEWBOX}`}
          role="img"
          aria-label={`Ordre des traits de ${ch}`}
          className="shrink-0 rounded-sm border border-hairline"
        >
          {/* Fantôme : le caractère complet en filet léger, pour voir où le geste va. */}
          <g fill="none" stroke="var(--hairline-strong)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            {paths.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          <g
            key={run}
            fill="none"
            stroke="var(--text)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                pathLength={1}
                className="stroke-draw"
                style={
                  {
                    "--stroke-ms": `${STROKE_MS}ms`,
                    "--stroke-delay": `${i * STROKE_MS}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </g>
        </svg>
        <div className="flex flex-col items-start gap-1 text-sm text-muted">
          <span>
            {paths.length} trait{paths.length > 1 ? "s" : ""}
          </span>
          <button
            className="min-h-11 cursor-pointer rounded-sm border border-hairline px-2 py-1 text-sm text-text transition-colors hover:border-accent"
            onClick={() => setRun((n) => n + 1)}
          >
            Rejouer
          </button>
        </div>
      </div>
    </div>
  );
}
