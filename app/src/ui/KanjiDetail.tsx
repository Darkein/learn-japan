// Fiche kanji : caractère, sens, lectures, traits, niveau, tracé animé, composition en
// parties, et mots liés — d'abord ceux déjà travaillés (ancrage), puis des suggestions à
// découvrir qu'on peut ajouter au SRS d'un tap. Purement référentiel : pas de SRS kanji.
//
// Contenu seul, sans feuille : RefSheet/WordSheet l'affichent dans LEUR feuille, avec une
// rangée retour (navigation mot → kanji → mot, plus d'empilement de modales). Chaque mot
// lié est une rangée tapable qui ouvre sa fiche (`onOpenVocab`) ; « À revoir » reste un
// bouton à part sur la même rangée.

import { useEffect, useState } from "react";
import { allVocab, type ItemStatus } from "../lib/db";
import { type InvVocab, kanjiDetail } from "../lib/inventory";
import { kanjiMnemonic } from "../lib/mnemonics";
import type { Mnemonic } from "../lib/genParsers";
import { relatedWords } from "../lib/kanjiInfo";
import { kanjiSpeechText } from "../lib/speech";
import { speakWord, stopSentence } from "../lib/tts";
import { addInventoryWordToReview } from "../lib/vocab";
import { StatusTag } from "./CatalogueInventory";
import { KanjiParts } from "./KanjiParts";
import { KanjiStrokes } from "./KanjiStrokes";
import { Badge } from "./kit/Badge";
import { Emphasis } from "./kit/Emphasis";
import { IconSpeaker } from "./kit/Icon";

const SUGGESTIONS_COLLAPSED = 8;
const SUGGESTIONS_EXPANDED = 30;

// Rangée d'un mot lié : la partie tapable (mot, lecture, sens, niveau) est un bouton pleine
// largeur ; l'action de droite (statut ou « À revoir ») est un frère, pas un enfant — un
// bouton dans un bouton est invalide et le tap y serait ambigu.
const WORD_ROW = "flex min-h-11 items-center gap-x-3 border-t border-hairline";
const WORD_BTN =
  "flex min-w-0 grow cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-left transition-colors hover:text-accent";

export function KanjiDetail({
  ch,
  excludeVocabId,
  onOpenVocab,
}: {
  ch: string;
  /** Id du mot d'où l'on vient : exclu des mots liés (sa fiche est déjà ouverte). */
  excludeVocabId?: string;
  /** Tap sur un mot lié : ouvre sa fiche (avec le statut connu au moment du tap). */
  onOpenVocab: (v: InvVocab, status: ItemStatus) => void;
}) {
  const detail = kanjiDetail(ch);
  const [statuses, setStatuses] = useState<Map<string, ItemStatus> | null>(null);
  const [mnemonic, setMnemonic] = useState<Mnemonic | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);

  // Coupe la synthèse vocale à la fermeture (même précaution que WordSheet).
  useEffect(() => () => stopSentence(), []);

  // Mnémo kanji (corpus statique, chargé paresseusement — lib/mnemonics.ts).
  useEffect(() => {
    let cancelled = false;
    void kanjiMnemonic(ch).then((m) => {
      if (!cancelled) setMnemonic(m);
    });
    return () => {
      cancelled = true;
    };
  }, [ch]);

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
  // Le caractère seul ne dit pas comment le prononcer : la synthèse devinerait (et 宝
  // sortirait « takaramono »). On lui donne UNE lecture du référentiel, celle affichée
  // dans le bouton.
  const spoken = kanjiSpeechText(detail.kun, detail.on) || detail.ja;
  const shown = suggestions.slice(0, showAll ? SUGGESTIONS_EXPANDED : SUGGESTIONS_COLLAPSED);
  const hidden = suggestions.length - shown.length;

  async function addToReview(v: InvVocab) {
    await addInventoryWordToReview(v);
    // Bascule locale : le mot passe dans « Déjà connus » au prochain rendu.
    setStatuses((prev) => new Map(prev ?? []).set(v.id, "review"));
  }

  return (
    <>
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-5xl">{detail.ja}</span>
        <span className="text-lg">{detail.fr}</span>
        <button
          className="cursor-pointer self-center rounded-sm border border-hairline px-2 py-1 leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(spoken)}
          aria-label={`Écouter la lecture ${spoken}`}
          title={`Écouter « ${spoken} »`}
        >
          <IconSpeaker size={16} />
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

      {/* Le tracé se construit, puis on lit de quoi il est fait : la composition explique
          le caractère avant que le mnémo le raconte. */}
      <KanjiStrokes ch={ch} />
      <KanjiParts ch={ch} />

      {mnemonic && (mnemonic.story || mnemonic.composition) && (
        <div className="flex flex-col gap-1 rounded-sm border border-hairline p-3 text-sm">
          {/* UN mnémo (son + sens dans la même phrase) ; l'image = ce que le tracé évoque. */}
          {mnemonic.story && (
            <span>
              <span className="text-muted">Mnémo :</span>{" "}
              <span className="text-text">
                <Emphasis text={mnemonic.story} />
              </span>
            </span>
          )}
          {mnemonic.composition && (
            <span>
              <span className="text-muted">Image :</span>{" "}
              <span className="text-text">
                <Emphasis text={mnemonic.composition} />
              </span>
            </span>
          )}
        </div>
      )}

      {known.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-xs uppercase tracking-wider text-muted">Déjà connus</p>
          <ul className="flex list-none flex-col border-b border-hairline">
            {known.map(({ word: v, status }) => (
              <li key={v.id} className={WORD_ROW}>
                <button
                  className={WORD_BTN}
                  onClick={() => onOpenVocab(v, status)}
                  aria-label={`Ouvrir la fiche du mot ${v.ja}`}
                >
                  <span className="font-jp text-lg text-text">{v.ja}</span>
                  <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
                  <span className="grow font-sans text-sm text-text">{v.fr}</span>
                </button>
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
              <li key={v.id} className={WORD_ROW}>
                <button
                  className={WORD_BTN}
                  onClick={() => onOpenVocab(v, "unknown")}
                  aria-label={`Ouvrir la fiche du mot ${v.ja}`}
                >
                  <span className="font-jp text-lg text-text">{v.ja}</span>
                  <span className="font-jp text-sm text-muted">{v.yomi ?? ""}</span>
                  <span className="grow font-sans text-sm text-text">{v.fr}</span>
                  <Badge>N{v.level}</Badge>
                </button>
                <button
                  className="shrink-0 cursor-pointer rounded-sm border border-hairline px-2 py-1 text-xs text-text transition-colors hover:border-accent"
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
    </>
  );
}
