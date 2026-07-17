import { useEffect, useState } from "react";
import { kataToHira } from "../lib/kana";
import type { ItemStatus } from "../lib/db";
import { encounterInfo, type ReEncounter } from "../lib/encounters";
import { formatDaysAgo } from "../lib/time";
import { speakWord, stopSentence } from "../lib/tts";
import { isContent, itemIdFor, meaningFor, type StatusAction } from "../lib/vocab";
import { vocabMnemonic } from "../lib/mnemonics";
import type { Mnemonic } from "../lib/genParsers";
import type { KuromojiToken } from "../lib/tokenizer";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { KanjiSheet } from "./KanjiSheet";
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
  const [mnemonic, setMnemonic] = useState<Mnemonic | undefined>(undefined);
  const [encounter, setEncounter] = useState<ReEncounter | null>(null);
  const [kanjiOpen, setKanjiOpen] = useState<string | null>(null);

  // Mnémo mot (corpus statique, chargé paresseusement — lib/mnemonics.ts) : l'id du token
  // (`basic_form|lecture`) coïncide avec l'id inventaire (`surface|lecture`) pour les mots
  // usuels. Absent → rien affiché.
  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    void vocabMnemonic(itemIdFor(token)).then((m) => {
      if (!cancelled) setMnemonic(m);
    });
    return () => {
      cancelled = true;
    };
  }, [token, content]);

  // Fermeture de la fiche : coupe la synthèse vocale en cours (sinon l'utterance
  // orpheline peut laisser le focus audio OS actif et le ducking du volume système).
  useEffect(() => () => stopSentence(), []);

  // Retrouvailles : « croisé pour la 5ᵉ fois · appris il y a 12 jours ».
  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    void encounterInfo(itemIdFor(token)).then((e) => {
      if (!cancelled) setEncounter(e);
    });
    return () => {
      cancelled = true;
    };
  }, [token, content]);

  return (
    <>
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
      {encounter && encounter.count >= 2 && (
        <div className="text-sm text-muted">
          Croisé pour la {encounter.count}ᵉ fois
          {encounter.learnedAt != null && <> · appris {formatDaysAgo(encounter.learnedAt)}</>}
        </div>
      )}

      {mnemonic && (mnemonic.story || mnemonic.composition) && (
        <div className="flex flex-col gap-1 rounded-sm border border-hairline p-3 text-sm">
          {/* UN mnémo (son + sens dans la même phrase) ; la composition est une explication. */}
          {mnemonic.story && (
            <span>
              <span className="text-muted">Mnémo :</span>{" "}
              <span className="text-text">{mnemonic.story}</span>
            </span>
          )}
          {mnemonic.composition && (
            <span>
              <span className="text-muted">Composition :</span>{" "}
              <span className="text-text">{mnemonic.composition}</span>
            </span>
          )}
        </div>
      )}

      <KanjiBreakdown
        surface={token.basic_form || token.surface_form}
        onOpenKanji={setKanjiOpen}
      />

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

    {/* Fiche kanji empilée : rendue après le Sheet parent → au-dessus (même z-50). */}
    {kanjiOpen && (
      <KanjiSheet
        ch={kanjiOpen}
        excludeVocabId={itemIdFor(token)}
        onClose={() => setKanjiOpen(null)}
      />
    )}
    </>
  );
}
