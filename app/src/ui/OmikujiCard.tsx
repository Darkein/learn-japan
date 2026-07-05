import { useEffect, useState } from "react";
import {
  challengeById,
  checkOmikuji,
  FORTUNES,
  omikujiProgress,
  type OmikujiCheck,
} from "../lib/omikuji";
import { Button } from "./kit/Button";
import { ProgressBar } from "./kit/ProgressBar";
import { SectionLabel } from "./kit/SectionLabel";
import { OmikujiSheet } from "./OmikujiSheet";
import { useNotify } from "./useNotify";

/**
 * Carte omikuji de l'accueil : « Tirer » avant le tirage, jauge du défi ensuite, ligne
 * calme une fois accompli (jamais un second accent sur l'écran — le bloc révision garde
 * le primary).
 */
export function OmikujiCard() {
  const [check, setCheck] = useState<OmikujiCheck | null | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { notify } = useNotify();

  async function refresh() {
    const result = await checkOmikuji();
    setCheck(result);
    if (result?.completedNow) {
      notify({ message: "Omikuji accompli — un peu de chemin gagné sur le Tōkaidō." });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (check === undefined) return null; // chargement silencieux — pas de squelette pour une carte secondaire

  // Pas encore tiré aujourd'hui.
  if (check === null) {
    return (
      <>
        <div className="flex items-center justify-between gap-4 border-y border-hairline py-3">
          <div className="flex flex-col">
            <SectionLabel>Omikuji du jour</SectionLabel>
            <span className="text-sm text-muted">Tire ta fortune au temple — un défi surprise.</span>
          </div>
          <Button onClick={() => setSheetOpen(true)}>Tirer</Button>
        </div>
        {sheetOpen && (
          <OmikujiSheet
            onClose={() => {
              setSheetOpen(false);
              void refresh();
            }}
          />
        )}
      </>
    );
  }

  const { rec, counts, env } = check;
  const fortune = FORTUNES.find((f) => f.id === rec.fortune);
  const challenge = challengeById(rec.challengeId);

  // Accompli : une ligne calme.
  if (rec.completedAt) {
    return (
      <p className="m-0 border-y border-hairline py-3 text-sm text-muted">
        Défi du jour accompli · <span className="font-jp text-text">{fortune?.kanji}</span>{" "}
        {fortune?.fr}
      </p>
    );
  }

  // Tiré, en cours.
  const { done, target } = omikujiProgress(rec, counts, env);
  return (
    <div className="flex flex-col gap-2 border-y border-hairline py-3">
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel>
          Omikuji · <span className="font-jp normal-case tracking-normal">{fortune?.kanji}</span>
        </SectionLabel>
        <span className="text-xs text-muted">
          {done} / {target}
        </span>
      </div>
      {challenge && <span className="text-sm text-text">{challenge.label(env)}</span>}
      <ProgressBar value={(done / Math.max(1, target)) * 100} />
    </div>
  );
}
