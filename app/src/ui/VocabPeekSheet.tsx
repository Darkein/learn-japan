// Fiche mot du Catalogue : aperçu d'une entrée de l'inventaire (mot pas forcément
// en base) avec sa décomposition en kanji. Pas de boutons SRS ici — l'ajout se
// fait depuis le lecteur (WordSheet) ou la fiche kanji (suggestions). La fiche
// kanji s'affiche dans la même feuille (rangée retour), comme WordSheet.

import { useEffect, useState } from "react";
import type { ItemStatus } from "../lib/db";
import type { InvVocab } from "../lib/inventory";
import { speakWord, stopSentence } from "../lib/tts";
import { BottomSheet } from "./BottomSheet";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { KanjiDetail } from "./KanjiSheet";
import { Badge } from "./kit/Badge";
import { IconSpeaker } from "./kit/Icon";

const STATUS_FR: Record<ItemStatus, string> = {
  unknown: "jamais marqué",
  review: "à réviser",
  known: "connu",
};

export function VocabPeekSheet({
  v,
  status,
  onClose,
}: {
  v: InvVocab;
  status: ItemStatus;
  onClose: () => void;
}) {
  const [kanjiOpen, setKanjiOpen] = useState<string | null>(null);

  // Coupe la synthèse vocale à la fermeture (même précaution que WordSheet).
  useEffect(() => () => stopSentence(), []);

  return (
    <BottomSheet
      onClose={onClose}
      resetKey={kanjiOpen}
      ariaLabel={kanjiOpen ? `Fiche du kanji ${kanjiOpen}` : `Fiche du mot ${v.ja}`}
    >
      {kanjiOpen ? (
        <>
          <button
            className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-sm text-muted transition-colors hover:text-text"
            onClick={() => setKanjiOpen(null)}
          >
            ← Retour à <span className="font-jp text-text">{v.ja}</span>
          </button>
          <KanjiDetail ch={kanjiOpen} excludeVocabId={v.id} />
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="font-jp text-2xl">{v.ja}</span>
            {v.yomi && <span className="text-lg text-muted">{v.yomi}</span>}
            <button
              className="cursor-pointer self-center rounded-sm border border-hairline px-2 py-1 leading-none transition-colors hover:border-accent"
              onClick={() => speakWord(v.ja)}
              aria-label="Écouter le mot"
              title="Écouter"
            >
              <IconSpeaker size={16} />
            </button>
            <Badge className="ml-auto">N{v.level}</Badge>
          </div>

          <div className="text-lg">{v.fr}</div>
          <div className="text-sm text-muted">Statut : {STATUS_FR[status]}</div>

          <KanjiBreakdown surface={v.ja} onOpenKanji={setKanjiOpen} />
        </>
      )}
    </BottomSheet>
  );
}
