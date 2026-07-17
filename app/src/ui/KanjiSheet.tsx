// Fiche kanji : caractère, sens, lectures, traits, niveau, et mots liés —
// d'abord ceux déjà travaillés (ancrage), puis des suggestions à découvrir
// qu'on peut ajouter au SRS d'un tap. Purement référentiel : pas de SRS kanji.
//
// S'empile au-dessus d'un WordSheet/VocabPeekSheet ouvert (rendue après dans le
// DOM → au-dessus). Limitation connue du kit Sheet : Échap ferme les deux
// feuilles empilées ; le clic sur le fond, lui, ne ferme que celle du dessus.

import { useEffect, useState } from "react";
import { allVocab, type ItemStatus } from "../lib/db";
import { type InvVocab, kanjiDetail } from "../lib/inventory";
import { relatedWords } from "../lib/kanjiInfo";
import { speakWord, stopSentence } from "../lib/tts";
import { addInventoryWordToReview } from "../lib/vocab";
import { StatusTag } from "./CatalogueInventory";
import { Badge } from "./kit/Badge";
import { Sheet } from "./kit/Sheet";

const SUGGESTIONS_COLLAPSED = 8;
const SUGGESTIONS_EXPANDED = 30;

export function KanjiSheet({
  ch,
  excludeVocabId,
  onClose,
}: {
  ch: string;
  /** Id du mot d'où l'on vient : exclu des mots liés (sa fiche est déjà ouverte). */
  excludeVocabId?: string;
  onClose: () => void;
}) {
  const detail = kanjiDetail(ch);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus> | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Coupe la synthèse vocale à la fermeture (même précaution que WordSheet).
  useEffect(() => () => stopSentence(), []);

  useEffect(() => {
    let cancelled = false;
    void allVocab().then((items) => {
      if (!cancelled) setStatuses(new Map(items.map((v) => [v.id, v.status])));
    });
    return () => {
      cancelled = true;
    };
  }, [ch]);

  if (!detail) return null;

  const { known, suggestions } = relatedWords(ch, statuses ?? new Map(), excludeVocabId);
  const shown = suggestions.slice(0, showAll ? SUGGESTIONS_EXPANDED : SUGGESTIONS_COLLAPSED);
  const hidden = suggestions.length - shown.length;

  async function addToReview(v: InvVocab) {
    await addInventoryWordToReview(v);
    // Bascule locale : le mot passe dans « Déjà connus » au prochain rendu.
    setStatuses((prev) => new Map(prev ?? []).set(v.id, "review"));
  }

  return (
    <Sheet open onClose={onClose} className="gap-3 px-4 pt-6">
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-5xl">{detail.ja}</span>
        <span className="text-lg">{detail.fr}</span>
        <button
          className="cursor-pointer rounded-sm border border-hairline px-2 py-0.5 text-base leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(detail.ja)}
          aria-label="Écouter le mot"
          title="Écouter"
        >
          🔊
        </button>
        <Badge className="ml-auto">N{detail.level}</Badge>
      </div>

      <div className="flex flex-col gap-1 text-sm text-muted">
        {detail.kun.length > 0 && (
          <span>
            Lectures kun : <span className="font-jp text-text">{detail.kun.join("・")}</span>
          </span>
        )}
        {detail.on.length > 0 && (
          <span>
            Lectures on : <span className="font-jp text-text">{detail.on.join("・")}</span>
          </span>
        )}
        {detail.strokes != null && <span>{detail.strokes} traits</span>}
      </div>

      {detail.mnemonic && (detail.mnemonic.story || detail.mnemonic.composition) && (
        <div className="flex flex-col gap-1 rounded-sm border border-hairline p-3 text-sm">
          {/* UN mnémo (son + sens dans la même phrase) ; l'image = ce que le tracé évoque. */}
          {detail.mnemonic.story && (
            <span>
              <span className="text-muted">Mnémo :</span>{" "}
              <span className="text-text">{detail.mnemonic.story}</span>
            </span>
          )}
          {detail.mnemonic.composition && (
            <span>
              <span className="text-muted">Image :</span>{" "}
              <span className="text-text">{detail.mnemonic.composition}</span>
            </span>
          )}
        </div>
      )}

      {known.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs uppercase tracking-wider text-muted">Déjà connus</p>
          <ul className="flex list-none flex-col border-b border-hairline">
            {known.map(({ word: v, status }) => (
              <li
                key={v.id}
                className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline py-2"
              >
                <span className="font-jp text-lg text-text">{v.ja}</span>
                <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
                <span className="grow font-sans text-sm text-text">{v.fr}</span>
                <StatusTag status={status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs uppercase tracking-wider text-muted">À découvrir</p>
          <ul className="flex list-none flex-col border-b border-hairline">
            {shown.map((v) => (
              <li
                key={v.id}
                className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline py-2"
              >
                <span className="font-jp text-lg text-text">{v.ja}</span>
                <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
                <span className="grow font-sans text-sm text-text">{v.fr}</span>
                <Badge>N{v.level}</Badge>
                <button
                  className="cursor-pointer rounded-sm border border-hairline px-2 py-1 text-xs text-text transition-colors hover:border-accent"
                  onClick={() => void addToReview(v)}
                >
                  À revoir
                </button>
              </li>
            ))}
          </ul>
          {hidden > 0 && !showAll && (
            <button
              className="mt-1 cursor-pointer self-start text-sm text-muted underline-offset-4 hover:text-text hover:underline"
              onClick={() => setShowAll(true)}
            >
              Afficher plus ({hidden})
            </button>
          )}
        </div>
      )}

      {known.length === 0 && suggestions.length === 0 && (
        <p className="text-sm text-muted">Aucun mot de l'inventaire ne contient ce kanji.</p>
      )}
    </Sheet>
  );
}
