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
          <PaperSlip text="御神籤" className="font-jp text-lg text-muted" />
          <p className="m-0 text-xs text-muted">
            御神籤（おみくじ, omikuji） — « le tirage sacré », la bandelette de fortune du temple.
          </p>
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
          <PaperSlip text={fortune.kanji} className="font-jp text-2xl text-text" />
          <div className="flex flex-col gap-1">
            <SectionLabel>{fortune.fr}</SectionLabel>
            <p className="m-0 text-xs text-muted">
              {fortune.kanji}（{fortune.yomi}） se lit « {fortune.romaji} »
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            {challenge && (
              <p className="m-0 max-w-sm font-serif text-lg text-text">{challenge.label(labelEnv())}</p>
            )}
            <p className="m-0 text-xs text-muted">
              Défi accompli : tu gagnes {fortune.bonusFr} sur la route — la fortune fixe
              la mise, jamais une punition.
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

/** La bandelette de papier : verticale, filets, caractères empilés de haut en bas. */
function PaperSlip({ text, className }: { text: string; className: string }) {
  return (
    <div className="flex min-h-36 w-16 flex-col items-center justify-center gap-1 border border-hairline-strong bg-bg px-2 py-4 shadow-elev">
      {[...text].map((ch, i) => (
        <span key={i} className={`leading-none ${className}`}>
          {ch}
        </span>
      ))}
    </div>
  );
}
