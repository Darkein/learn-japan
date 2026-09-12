// Fiche mot de l'inventaire : aperçu d'une entrée (mot pas forcément en base) avec sa
// décomposition en kanji. Pas de boutons SRS ici — l'ajout se fait depuis le lecteur
// (WordSheet) ou la fiche kanji (suggestions) ; seule exception, la remise à zéro d'un mot
// devenu difficile, qui doit être à portée de la liste des mots. Contenu seul, sans feuille :
// RefSheet et WordSheet l'affichent dans LEUR feuille, avec une rangée retour ; un tap sur un
// kanji de la décomposition empile sa fiche (`onOpenKanji`).

import { useEffect, useState } from "react";
import type { ItemStatus } from "../lib/db";
import type { InvVocab } from "../lib/inventory";
import { loadLeechIds } from "../lib/leech";
import { wordSpeechText } from "../lib/speech";
import { speakWord, stopSentence } from "../lib/tts";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { Badge } from "./kit/Badge";
import { IconSpeaker } from "./kit/Icon";
import { ResetProgressButton } from "./ResetProgressButton";

const STATUS_FR: Record<ItemStatus, string> = {
  unknown: "jamais marqué",
  review: "à réviser",
  known: "connu",
};

export function VocabPeekDetail({
  v,
  status,
  onOpenKanji,
}: {
  v: InvVocab;
  status: ItemStatus;
  onOpenKanji: (ch: string) => void;
}) {
  // Élément difficile : lu ici plutôt que passé en prop — la fiche s'ouvre depuis deux hôtes
  // (Catalogue, lecteur) et aucun des deux n'a besoin de connaître les leeches.
  const [difficult, setDifficult] = useState(false);
  // Après une remise à zéro, le mot repart « à réviser » : on l'affiche sans attendre que
  // l'hôte recharge son propre statut.
  const [resetStatus, setResetStatus] = useState<ItemStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void loadLeechIds().then((ids) => {
      if (alive) setDifficult(ids.has(v.id));
    });
    return () => {
      alive = false;
    };
  }, [v.id]);

  // Coupe la synthèse vocale à la fermeture (même précaution que WordSheet).
  useEffect(() => () => stopSentence(), []);

  return (
    <>
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-2xl">{v.ja}</span>
        {v.yomi && <span className="text-lg text-muted">{v.yomi}</span>}
        <button
          className="cursor-pointer self-center rounded-sm border border-hairline px-2 py-1 leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(wordSpeechText(v.ja, v.yomi))}
          aria-label="Écouter le mot"
          title="Écouter"
        >
          <IconSpeaker size={16} />
        </button>
        <Badge className="ml-auto">N{v.level}</Badge>
      </div>

      <div className="text-lg">{v.fr}</div>
      <div className="text-sm text-muted">Statut : {STATUS_FR[resetStatus ?? status]}</div>

      {difficult && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="accent">Élément difficile</Badge>
          <span className="text-xs text-muted">échecs répétés — le mot repasse au QCM</span>
          <ResetProgressButton
            track="vocab"
            id={v.id}
            className="ml-auto"
            onDone={() => {
              setDifficult(false);
              setResetStatus("review");
            }}
          />
        </div>
      )}

      <KanjiBreakdown surface={v.ja} reading={v.yomi} onOpenKanji={onOpenKanji} />
    </>
  );
}
