// Fiche mot du Catalogue : aperçu d'une entrée de l'inventaire (mot pas forcément
// en base) avec sa décomposition en kanji. Pas de boutons SRS ici — l'ajout se
// fait depuis le lecteur (WordSheet) ou la fiche kanji (suggestions).

import { useEffect } from "react";
import type { ItemStatus } from "../lib/db";
import type { InvVocab } from "../lib/inventory";
import { speakWord, stopSentence } from "../lib/tts";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { Badge } from "./kit/Badge";
import { Sheet } from "./kit/Sheet";

const STATUS_FR: Record<ItemStatus, string> = {
  unknown: "jamais marqué",
  review: "à réviser",
  known: "connu",
};

export function VocabPeekSheet({
  v,
  status,
  onOpenKanji,
  onClose,
}: {
  v: InvVocab;
  status: ItemStatus;
  onOpenKanji: (ch: string) => void;
  onClose: () => void;
}) {
  // Coupe la synthèse vocale à la fermeture (même précaution que WordSheet).
  useEffect(() => () => stopSentence(), []);

  return (
    <Sheet open onClose={onClose} className="gap-3 px-4 pt-6">
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-2xl">{v.ja}</span>
        {v.yomi && <span className="text-lg text-muted">{v.yomi}</span>}
        <button
          className="cursor-pointer rounded-sm border border-hairline px-2 py-0.5 text-base leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(v.ja)}
          aria-label="Écouter le mot"
          title="Écouter"
        >
          🔊
        </button>
        <Badge className="ml-auto">N{v.level}</Badge>
      </div>

      <div className="text-lg">{v.fr}</div>
      <div className="text-sm text-muted">Statut : {STATUS_FR[status]}</div>

      <KanjiBreakdown surface={v.ja} onOpenKanji={onOpenKanji} />
    </Sheet>
  );
}
