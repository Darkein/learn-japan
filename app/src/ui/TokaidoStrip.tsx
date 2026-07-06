import { useEffect, useRef } from "react";
import type { TokaidoPosition } from "../lib/tokaido";
import { TOKAIDO } from "../data/tokaido";
import { SectionLabel } from "./kit/SectionLabel";

interface Props {
  pos: TokaidoPosition;
  onOpen: () => void;
}

/** Espacement horizontal entre deux stations (px) — fixe, la bande défile. */
const STEP = 48;
const LINE_Y = 34; // ordonnée de la voie dans la zone dessinée (px)
const STRIP_H = 96; // voie + poteaux kanji verticaux

/**
 * Bandeau du voyage (accueil) : fenêtre scrollable/swipable sur la route, auto-centrée
 * sur le train. Chaque station est un poteau avec son nom en kanji vertical (façon
 * panneau de route) ; le train vermillon roule sur la ligne d'encre. Le détail complet
 * (toutes les étapes, notes) reste dans la vue Voyage, ouverte au tap.
 */
export function TokaidoStrip({ pos, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const arrived = !pos.next;
  const trainX = pos.position * STEP + STEP / 2;
  const innerW = (TOKAIDO.length - 1) * STEP + STEP;

  // Centre la fenêtre sur le train (sans animation : c'est l'état, pas un mouvement).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = trainX - el.clientWidth / 2;
  }, [trainX]);

  return (
    <div className="flex flex-col gap-2">
      <button
        className="flex cursor-pointer items-baseline justify-between gap-4 text-left"
        onClick={onOpen}
        aria-label="Voir le voyage sur le Tōkaidō"
      >
        <SectionLabel className="shrink-0 whitespace-nowrap">
          Tōkaidō · étape {pos.station.index}/{TOKAIDO.length - 1}
        </SectionLabel>
        <span className="truncate text-xs text-muted">
          <span className="font-jp text-text">{pos.station.kanji}</span> {pos.station.romaji}
          {pos.next && (
            <>
              {" → "}
              <span className="font-jp">{pos.next.kanji}</span> {pos.next.romaji} ·{" "}
              {pos.betweenPct} %
            </>
          )}
        </span>
      </button>
      <div
        ref={scroller}
        className="cursor-pointer overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onClick={onOpen}
        aria-hidden="true"
      >
        <div className="relative" style={{ width: innerW, height: STRIP_H }}>
          <svg
            className="absolute inset-0"
            width={innerW}
            height={STRIP_H}
            viewBox={`0 0 ${innerW} ${STRIP_H}`}
            aria-hidden="true"
          >
            {/* Voie ferrée : traverses (ligne épaisse en pointillés verticaux) sous deux
                rails parallèles. Le chemin parcouru repasse les rails à l'encre. */}
            <line
              x1={0}
              y1={LINE_Y}
              x2={innerW}
              y2={LINE_Y}
              stroke="var(--hairline)"
              strokeWidth={5}
              strokeDasharray="1.5 8.1"
            />
            <line x1={0} y1={LINE_Y - 2} x2={innerW} y2={LINE_Y - 2} stroke="var(--hairline)" strokeWidth={1} />
            <line x1={0} y1={LINE_Y + 2} x2={innerW} y2={LINE_Y + 2} stroke="var(--hairline)" strokeWidth={1} />
            <line x1={0} y1={LINE_Y - 2} x2={trainX} y2={LINE_Y - 2} stroke="var(--ink)" strokeWidth={1.2} />
            <line x1={0} y1={LINE_Y + 2} x2={trainX} y2={LINE_Y + 2} stroke="var(--ink)" strokeWidth={1.2} />
            {/* Poteaux de station (passées = ink, à venir = hairline). */}
            {TOKAIDO.map((s) => (
              <line
                key={s.index}
                x1={s.index * STEP + STEP / 2}
                y1={LINE_Y + 5}
                x2={s.index * STEP + STEP / 2}
                y2={LINE_Y + 9}
                stroke={s.index <= pos.position ? "var(--ink)" : "var(--hairline)"}
                strokeWidth={s.index % 11 === 0 ? 1.5 : 1}
              />
            ))}
            {/* Le train : motrice + deux voitures de passagers du même gabarit, nez
                EXACTEMENT sur l'avancement. Roues dessinées d'abord : les caisses passent
                par-dessus (roues à demi cachées, comme il se doit). */}
            <g transform={`translate(${trainX - 81}, ${LINE_Y - 15.5})`}>
              {[0, 26].map((x) => (
                <g key={x} transform={`translate(${x}, 0)`}>
                  <circle cx={5.5} cy={15.5} r={2} fill="var(--ink)" />
                  <circle cx={18.5} cy={15.5} r={2} fill="var(--ink)" />
                  {/* Caisse descendue d'1px sur les roues. */}
                  <g transform="translate(0, 1)">
                    <rect x={0} y={1} width={24} height={13.5} rx={2} fill="var(--accent)" />
                    <rect x={3.5} y={4} width={4.5} height={4} rx={1} fill="var(--bg)" />
                    <rect x={10} y={4} width={4.5} height={4} rx={1} fill="var(--bg)" />
                    <rect x={16.5} y={4} width={4.5} height={4} rx={1} fill="var(--bg)" />
                    {/* Attelage vers le véhicule suivant. */}
                    <line x1={24} y1={10} x2={26} y2={10} stroke="var(--ink)" strokeWidth={1.5} />
                  </g>
                </g>
              ))}
              {/* Motrice façon shinkansen : nez profilé bien rond (deux cubiques), vitre de
                  cabine effilée dans la pente, bandeau de fenêtres continu sur le flanc. */}
              <g transform="translate(50, 0)">
                <circle cx={8} cy={15.5} r={2} fill="var(--ink)" />
                <circle cx={22} cy={15.5} r={2} fill="var(--ink)" />
                {/* Caisse descendue d'1px sur les roues, pointe à grand rayon. */}
                <g transform="translate(0, 1)">
                  <path
                    d="M2 4 q0 -3 3 -3 h8 c6 0 10.5 2.5 14 6 c2 2 3.3 3.6 3.8 5 q0.8 2.5 -2.6 2.5 h-24.2 q-2 0 -2 -1.5 z"
                    fill="var(--accent)"
                  />
                  <rect
                    x={19}
                    y={3.6}
                    width={6}
                    height={2}
                    rx={1}
                    fill="var(--bg)"
                    transform="rotate(33 22 4.6)"
                  />
                  <rect x={4} y={4.5} width={12} height={2.2} rx={1.1} fill="var(--bg)" />
                </g>
              </g>
            </g>
          </svg>
          {/* Noms en kanji verticaux sous les poteaux, façon panneaux de route. */}
          {TOKAIDO.map((s) => (
            <span
              key={s.index}
              className={`absolute font-jp text-xs leading-none ${
                s.index === pos.station.index ? "text-text" : "text-muted"
              }`}
              style={{
                left: s.index * STEP + STEP / 2,
                top: LINE_Y + 10,
                writingMode: "vertical-rl",
                translate: "-50%",
              }}
            >
              {s.kanji}
            </span>
          ))}
        </div>
      </div>
      {arrived && <span className="text-xs text-muted">Kyōto atteint — la route est faite.</span>}
    </div>
  );
}
