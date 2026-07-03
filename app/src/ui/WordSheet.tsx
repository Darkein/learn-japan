import { useEffect } from "react";
import { kataToHira } from "../lib/kana";
import type { ItemStatus } from "../lib/db";
import { speakWord, stopSentence } from "../lib/tts";
import { isContent, meaningFor, type StatusAction } from "../lib/vocab";
import type { KuromojiToken } from "../lib/tokenizer";
import { Sheet } from "./kit/Sheet";

const POS_FR: Record<string, string> = {
  名詞: "nom",
  動詞: "verbe",
  形容詞: "adjectif",
  副詞: "adverbe",
  助詞: "particule",
  助動詞: "auxiliaire",
  連体詞: "déterminant",
  接続詞: "conjonction",
  感動詞: "interjection",
  記号: "ponctuation",
  接頭詞: "préfixe",
  フィラー: "hésitation",
};

const STATUS_FR: Record<ItemStatus, string> = {
  unknown: "jamais marqué",
  review: "à réviser",
  known: "connu",
};

const ACTIONS: { id: StatusAction; label: string }[] = [
  { id: "known", label: "Je connais" },
  { id: "review", label: "À revoir" },
  { id: "forgot", label: "Oublié" },
];

export function WordSheet({
  token,
  status,
  onAction,
  onClose,
}: {
  token: KuromojiToken;
  status: ItemStatus;
  onAction: (a: StatusAction) => void;
  onClose: () => void;
}) {
  const reading = token.reading ? kataToHira(token.reading) : "";
  const content = isContent(token);

  // Fermeture de la fiche : coupe la synthèse vocale en cours (sinon l'utterance
  // orpheline peut laisser le focus audio OS actif et le ducking du volume système).
  useEffect(() => () => stopSentence(), []);

  return (
    <Sheet open onClose={onClose} className="gap-3 px-4 pt-6">
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-2xl">{token.surface_form}</span>
        {reading && reading !== token.surface_form && (
          <span className="text-lg text-muted">{reading}</span>
        )}
        <button
          className="cursor-pointer rounded-sm border border-hairline px-2 py-0.5 text-base leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(token.surface_form)}
          aria-label="Écouter le mot"
          title="Écouter"
        >
          🔊
        </button>
        <span className="ml-auto font-sans text-xs uppercase tracking-wider text-muted">
          {POS_FR[token.pos] ?? token.pos}
        </span>
      </div>

      <div className="text-lg">{meaningFor(token)}</div>
      <div className="text-sm text-muted">Statut : {STATUS_FR[status]}</div>

      {content ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              className="grow basis-24 min-h-11 cursor-pointer rounded-sm border border-hairline p-3 text-text transition-colors hover:border-accent"
              onClick={() => onAction(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Morphème grammatical — suivi dans la piste grammaire (à venir), pas en vocabulaire.
        </p>
      )}
    </Sheet>
  );
}
