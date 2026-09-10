// Ordre des traits d'un kanji : le caractère se dessine trait à trait, dans l'ordre
// d'écriture (KanjiVG, cf. lib/strokes.ts). Rendu dans la fiche kanji, au-dessus de la
// composition — on voit le caractère se construire, puis on lit de quoi il est fait.
//
// Le mouvement EST le contenu ici : sous prefers-reduced-motion la règle globale coupe
// l'animation, le caractère s'affiche entier (stroke-dashoffset 0 par défaut) et le bouton
// « Rejouer » reste la seule façon de la déclencher.

import { useEffect, useState } from "react";
import { kanjiStrokes, STROKES_VIEWBOX } from "../lib/strokes";

/** Durée d'un trait : assez lente pour suivre le pinceau du bout de l'œil et refaire le
    geste, pas au point de s'endormir. */
const STROKE_MS = 480;
/** Levée du pinceau entre deux traits : sans elle, les traits s'enchaînent en un seul geste
    continu et on perd le découpage. */
const PAUSE_MS = 110;
/** Au-delà, un kanji à 20 traits durerait une éternité : on resserre le tempo, sans jamais
    redescendre sous 60 % (en deçà on retombe dans le défilement trop rapide). */
const MAX_TOTAL_MS = 9000;

/** Cadence d'un tracé de `n` traits : durée d'un trait et pas entre deux départs. */
function tempo(n: number): { ms: number; step: number } {
  const k = Math.max(0.6, Math.min(1, MAX_TOTAL_MS / (n * (STROKE_MS + PAUSE_MS))));
  const ms = Math.round(STROKE_MS * k);
  return { ms, step: ms + Math.round(PAUSE_MS * k) };
}

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

  const { ms, step } = tempo(paths.length);

  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wider text-muted">Tracé</p>
      {/* Carte pleine largeur plutôt que le carré collé à gauche avec « Rejouer » flottant
          dans le vide à sa droite : sur un écran de téléphone, la moitié de la ligne restait
          creuse. Le tracé est centré (et plus grand — le geste se suit mieux), l'action
          occupe toute la largeur sous un filet, comme le pied d'une carte. Le nombre de
          traits n'est pas repris ici : la fiche l'annonce déjà deux lignes plus haut. */}
      <div className="flex w-full flex-col rounded-sm border border-hairline sm:max-w-xs">
        <div className="flex justify-center p-3">
          <svg
            viewBox={`0 0 ${STROKES_VIEWBOX} ${STROKES_VIEWBOX}`}
            role="img"
            aria-label={`Ordre des traits de ${ch} (${paths.length} traits)`}
            className="h-auto w-full max-w-44"
          >
            {/* Fantôme : le caractère complet en filet léger, pour voir où le geste va. Pâle et
                plus fin que l'encre qui le recouvre — le trait déjà posé doit sauter aux yeux. */}
            <g fill="none" stroke="var(--stroke-ghost)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              {paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
            <g
              key={run}
              fill="none"
              stroke="var(--text)"
              strokeWidth={3.6}
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
                      "--stroke-ms": `${ms}ms`,
                      "--stroke-delay": `${i * step}ms`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </g>
          </svg>
        </div>
        <button
          className="min-h-11 cursor-pointer border-t border-hairline px-3 py-2 text-sm text-text transition-colors hover:bg-surface-2 hover:text-accent"
          onClick={() => setRun((n) => n + 1)}
        >
          Rejouer
        </button>
      </div>
    </div>
  );
}
