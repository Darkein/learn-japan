// Tableau des kanas du Catalogue : gojūon, dakuten/handakuten et yōon, avec
// bascule hiragana/katakana (aussi au swipe horizontal sur les grilles).
// Un tap sur une case prononce le kana (Web Speech) — pas de fiche : tout ce
// qu'une fiche montrerait (romaji, contrepartie) est déjà lisible dans la grille.

import { useEffect, useRef, useState } from "react";
import {
  DAKUTEN,
  GOJUON,
  GOJUON_HEADERS,
  YOON,
  YOON_HEADERS,
  kanaKatakana,
  kanaRomaji,
  type KanaCell,
} from "../lib/kanaTable";
import { speakWord, stopSentence } from "../lib/tts";
import { SegmentedControl } from "./kit/SegmentedControl";

type Script = "hiragana" | "katakana";

const SCRIPT_OPTIONS: { value: Script; label: string }[] = [
  { value: "hiragana", label: "Hiragana" },
  { value: "katakana", label: "Katakana" },
];

/** Distance horizontale (px) au-delà de laquelle le geste vaut bascule de syllabaire. */
const SWIPE_MIN_PX = 48;

/** Durée minimale (ms) du surlignage d'une case en lecture — assez pour être vu,
    même quand la synthèse est instantanée ou muette. */
const PLAY_FLASH_MS = 900;

export function KanaChart() {
  const [script, setScript] = useState<Script>("hiragana");
  const [playing, setPlaying] = useState<string | null>(null);
  const playSeq = useRef(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Coupe la synthèse vocale en quittant le tableau.
  useEffect(() => () => stopSentence(), []);

  async function play(cell: string) {
    const seq = ++playSeq.current;
    setPlaying(cell);
    // Surligné pendant toute la lecture, au moins PLAY_FLASH_MS.
    await Promise.all([speakWord(cell), new Promise((r) => setTimeout(r, PLAY_FLASH_MS))]);
    if (playSeq.current === seq) setPlaying(null);
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Geste franchement horizontal uniquement (ne pas voler le scroll vertical).
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
    setScript(dx < 0 ? "katakana" : "hiragana");
  }

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        ariaLabel="Syllabaire"
        options={SCRIPT_OPTIONS}
        value={script}
        onChange={setScript}
        fullWidth
        accent
        className="w-full max-w-sm"
      />
      <div className="flex flex-col gap-6" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <KanaGrid title="Gojūon" headers={GOJUON_HEADERS} rows={GOJUON} script={script} playing={playing} onPlay={play} />
        <KanaGrid title="Dakuten · handakuten" headers={GOJUON_HEADERS} rows={DAKUTEN} script={script} playing={playing} onPlay={play} />
        <KanaGrid title="Yōon" headers={YOON_HEADERS} rows={YOON} script={script} playing={playing} onPlay={play} />
      </div>
    </div>
  );
}

function KanaGrid({
  title,
  headers,
  rows,
  script,
  playing,
  onPlay,
}: {
  title: string;
  headers: string[];
  rows: KanaCell[][];
  script: Script;
  playing: string | null;
  onPlay: (hira: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0 font-sans text-xs uppercase tracking-wider text-muted">{title}</h2>
      <div
        className="grid max-w-sm gap-1"
        style={{ gridTemplateColumns: `repeat(${headers.length}, minmax(0, 1fr))` }}
      >
        {headers.map((h) => (
          <span key={h} aria-hidden="true" className="text-center font-sans text-xs text-muted">
            {h}
          </span>
        ))}
        {rows.flatMap((row, i) =>
          row.map((cell, j) =>
            cell === null ? (
              <span key={`${i}-${j}`} aria-hidden="true" />
            ) : (
              <button
                key={cell}
                onClick={() => onPlay(cell)}
                aria-label={`Écouter le kana ${cell}`}
                className={`flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-sm border py-1 transition-colors duration-500 ${
                  playing === cell
                    ? "border-accent bg-accent"
                    : "border-hairline hover:border-accent"
                }`}
              >
                <span className={`font-jp text-xl transition-colors duration-500 ${playing === cell ? "text-on-accent" : "text-text"}`}>
                  {script === "katakana" ? kanaKatakana(cell) : cell}
                </span>
                <span className={`font-sans text-[0.65rem] transition-colors duration-500 ${playing === cell ? "text-on-accent/80" : "text-muted"}`}>
                  {kanaRomaji(cell)}
                </span>
              </button>
            ),
          ),
        )}
      </div>
    </section>
  );
}
