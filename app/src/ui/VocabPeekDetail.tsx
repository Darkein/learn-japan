// Fiche mot de l'inventaire : aperçu d'une entrée (mot pas forcément en base) avec sa
// décomposition en kanji. Pas de boutons SRS ici — l'ajout se fait depuis le lecteur
// (WordSheet) ou la fiche kanji (suggestions). Contenu seul, sans feuille : RefSheet et
// WordSheet l'affichent dans LEUR feuille, avec une rangée retour ; un tap sur un kanji
// de la décomposition empile sa fiche (`onOpenKanji`).

import { useEffect } from "react";
import type { ItemStatus } from "../lib/db";
import type { InvVocab } from "../lib/inventory";
import { wordSpeechText } from "../lib/speech";
import { speakWord, stopSentence } from "../lib/tts";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { Badge } from "./kit/Badge";
import { IconSpeaker } from "./kit/Icon";

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
      <div className="text-sm text-muted">Statut : {STATUS_FR[status]}</div>

      <KanjiBreakdown surface={v.ja} reading={v.yomi} onOpenKanji={onOpenKanji} />
    </>
  );
}
