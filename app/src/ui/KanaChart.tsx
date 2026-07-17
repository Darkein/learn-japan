// Tableau des kanas du Catalogue : gojūon, dakuten/handakuten et yōon, avec
// bascule hiragana/katakana. Chaque case ouvre une fiche (feuille basse) avec
// le glyphe en grand, le romaji, la contrepartie et l'écoute — même patron que
// VocabPeekSheet, sans SRS ni base : tout est dérivé des grilles statiques.

import { useEffect, useState } from "react";
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
import { BottomSheet } from "./BottomSheet";
import { SegmentedControl } from "./kit/SegmentedControl";

type Script = "hiragana" | "katakana";

const SCRIPT_OPTIONS: { value: Script; label: string }[] = [
  { value: "hiragana", label: "Hiragana" },
  { value: "katakana", label: "Katakana" },
];

export function KanaChart() {
  const [script, setScript] = useState<Script>("hiragana");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        ariaLabel="Syllabaire"
        options={SCRIPT_OPTIONS}
        value={script}
        onChange={setScript}
      />
      <KanaGrid title="Gojūon" headers={GOJUON_HEADERS} rows={GOJUON} script={script} onOpen={setOpen} />
      <KanaGrid title="Dakuten · handakuten" headers={GOJUON_HEADERS} rows={DAKUTEN} script={script} onOpen={setOpen} />
      <KanaGrid title="Yōon" headers={YOON_HEADERS} rows={YOON} script={script} onOpen={setOpen} />
      {open && <KanaSheet kana={open} script={script} onClose={() => setOpen(null)} />}
    </div>
  );
}

function KanaGrid({
  title,
  headers,
  rows,
  script,
  onOpen,
}: {
  title: string;
  headers: string[];
  rows: KanaCell[][];
  script: Script;
  onOpen: (hira: string) => void;
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
                onClick={() => onOpen(cell)}
                aria-label={`Ouvrir la fiche du kana ${cell}`}
                className="flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-sm border border-hairline py-1 transition-colors hover:border-accent"
              >
                <span className="font-jp text-xl text-text">
                  {script === "katakana" ? kanaKatakana(cell) : cell}
                </span>
                <span className="font-sans text-[0.65rem] text-muted">{kanaRomaji(cell)}</span>
              </button>
            ),
          ),
        )}
      </div>
    </section>
  );
}

function KanaSheet({
  kana,
  script,
  onClose,
}: {
  kana: string;
  script: Script;
  onClose: () => void;
}) {
  // Coupe la synthèse vocale à la fermeture (même précaution que VocabPeekSheet).
  useEffect(() => () => stopSentence(), []);

  const kata = kanaKatakana(kana);
  const main = script === "katakana" ? kata : kana;
  const other = script === "katakana" ? kana : kata;

  return (
    <BottomSheet onClose={onClose} ariaLabel={`Fiche du kana ${main}`}>
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-5xl text-text">{main}</span>
        <span className="text-lg text-muted">{kanaRomaji(kana)}</span>
        <button
          className="cursor-pointer rounded-sm border border-hairline px-2 py-0.5 text-base leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(kana)}
          aria-label="Écouter le kana"
          title="Écouter"
        >
          🔊
        </button>
      </div>
      <div className="text-sm text-muted">
        {script === "katakana" ? "Hiragana" : "Katakana"} :{" "}
        <span className="font-jp text-lg text-text">{other}</span>
      </div>
    </BottomSheet>
  );
}
