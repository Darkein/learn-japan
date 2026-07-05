import { useEffect, useState } from "react";
import type { OmikujiRecord } from "../lib/db";
import { getOmikuji, localDateString } from "../lib/db";
import { challengeById, drawOmikuji, FORTUNES, type OmikujiEnv } from "../lib/omikuji";
import { loadSettings } from "../lib/settings";
import { Button } from "./kit/Button";
import { SectionLabel } from "./kit/SectionLabel";
import { Sheet } from "./kit/Sheet";

interface Props {
  onClose: () => void;
}

// Env minimal pour résoudre le libellé du défi (le tirage a déjà filtré la disponibilité).
function labelEnv(): OmikujiEnv {
  return {
    dailyGoal: loadSettings().dailyGoal,
    reviewedToday: 0,
    hasProductionCards: true,
    hasOralCards: true,
    hasStories: true,
  };
}

/**
 * La bandelette d'omikuji : tirage rituel (un tap), révélation sobre de la fortune
 * (kanji vertical, papier, filets — aucun doré, aucun confetti) et du défi du jour.
 */
export function OmikujiSheet({ onClose }: Props) {
  const [rec, setRec] = useState<OmikujiRecord | null>(null);
  const [drawn, setDrawn] = useState(false); // true si le tirage vient d'avoir lieu (révélation)

  useEffect(() => {
    void getOmikuji(localDateString()).then((r) => setRec(r ?? null));
  }, []);

  async function draw() {
    setRec(await drawOmikuji());
    setDrawn(true);
  }

  const fortune = rec ? FORTUNES.find((f) => f.id === rec.fortune) : null;
  const challenge = rec ? challengeById(rec.challengeId) : null;

  return (
    <Sheet open onClose={onClose} className="gap-4 px-4 pt-6 pb-8">
      <SectionLabel>Omikuji du jour</SectionLabel>

      {!rec && (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <PaperSlip>
            <span className="font-jp text-2xl text-muted">御神籤</span>
          </PaperSlip>
          <p className="m-0 max-w-sm text-sm text-muted">
            Tire ta fortune au temple : une bandelette, un défi surprise pour aujourd'hui.
          </p>
          <Button variant="primary" onClick={() => void draw()}>
            Tirer ma fortune
          </Button>
        </div>
      )}

      {rec && fortune && (
        <div className={`flex flex-col items-center gap-4 py-4 text-center ${drawn ? "animate-rise" : ""}`}>
          <PaperSlip>
            <span className="font-jp text-3xl text-text">{fortune.kanji}</span>
          </PaperSlip>
          <div className="flex flex-col gap-1">
            <SectionLabel>{fortune.fr}</SectionLabel>
            {challenge && (
              <p className="m-0 max-w-sm font-serif text-lg text-text">{challenge.label(labelEnv())}</p>
            )}
            <p className="m-0 text-xs text-muted">
              Défi accompli = un peu de chemin gagné sur le Tōkaidō. La fortune, elle, ne
              change rien — c'est un omikuji.
            </p>
          </div>
          <Button variant="primary" onClick={onClose}>
            C'est parti
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** La bandelette de papier : verticale, filets, écriture de haut en bas. */
function PaperSlip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-36 w-16 items-center justify-center border border-hairline-strong bg-bg px-2 py-4 shadow-elev"
      style={{ writingMode: "vertical-rl" }}
    >
      {children}
    </div>
  );
}
