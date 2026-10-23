import { useEffect, useMemo, useState } from "react";
import { hasJapanese, kataToHira } from "../lib/kana";
import { getLessonProgress, type ItemStatus } from "../lib/db";
import { grammarPointsAt, type MorphemePoint } from "../lib/morphemeGrammar";
import { glossAt } from "../lib/gloss";
import { contentDictSnapshot } from "../lib/data";
import { encounterInfo, type ReEncounter } from "../lib/encounters";
import { formatDaysAgo } from "../lib/time";
import { wordSpeechText } from "../lib/speech";
import { speakWord, stopSentence } from "../lib/tts";
import { isContent, isProperNoun, itemIdFor, meaningFor, type StatusAction } from "../lib/vocab";
import { vocabMnemonic } from "../lib/mnemonics";
import type { Mnemonic } from "../lib/genParsers";
import type { KuromojiToken } from "../lib/tokenizer";
import { BottomSheet } from "./BottomSheet";
import { KanjiBreakdown } from "./KanjiBreakdown";
import { BackRow, refAria, refLabel, RefStackView, useRefStack } from "./RefSheet";
import { Emphasis } from "./kit/Emphasis";
import { IconSpeaker } from "./kit/Icon";

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

/**
 * Pourquoi ce mot n'est pas suivi en vocabulaire — n'a de sens que pour un token écarté
 * par `isContent` (l'ordre des cas suit celui du filtre : écriture latine, nom propre,
 * morphème grammatical). Un morphème au programme dit où il s'apprend (`GrammarPoints`).
 */
function untrackedReason(token: KuromojiToken, inCurriculum: boolean): string {
  if (!hasJapanese(token.surface_form)) {
    return "Mot en écriture latine — non suivi en vocabulaire japonais.";
  }
  if (isProperNoun(token)) {
    return "Nom propre (personne, lieu, organisation) — non suivi en vocabulaire.";
  }
  return inCurriculum
    ? "Morphème grammatical — il s'apprend avec la grammaire de sa leçon, pas en vocabulaire."
    : "Morphème grammatical — non suivi en vocabulaire, et sans leçon de grammaire au programme.";
}

const LESSON_STATE_FR = { done: "vue", current: "en cours", later: "à venir" } as const;
type LessonState = keyof typeof LESSON_STATE_FR;

/**
 * Le ou les points de grammaire du morphème, chacun avec la leçon qui l'enseigne et où tu en
 * es (vue, en cours, à venir). Plusieurs emplois pour une même forme (に : lieu, moment,
 * destination) : tous sont nommés, le token seul ne dit pas lequel joue ici.
 */
function GrammarPoints({ points }: { points: MorphemePoint[] }) {
  const [states, setStates] = useState<Map<string, LessonState>>(new Map());
  const key = points.map((p) => p.id).join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      points.map(async (p) => {
        const rec = p.lesson ? await getLessonProgress(p.lesson.id) : undefined;
        const state: LessonState = rec?.completedAt || rec?.examPassedAt ? "done" : rec?.startedAt ? "current" : "later";
        return [p.id, state] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setStates(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-hairline p-3 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted">
        {points.length > 1 ? "Points de grammaire" : "Point de grammaire"}
      </span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {points.map((p) => {
          const state = states.get(p.id);
          return (
            <li key={p.id} className="flex flex-col">
              <span className="font-jp text-text">{p.name}</span>
              {p.lesson && (
                <span className="text-muted">
                  N{p.lesson.level} · Leçon {p.lesson.order} · {p.lesson.title}
                  {state && (
                    <span className={state === "later" ? "" : "text-accent"}> — {LESSON_STATE_FR[state]}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WordSheet({
  token,
  sentence,
  status,
  onAction,
  onClose,
}: {
  token: KuromojiToken;
  /** Le texte autour du mot : son emploi se lit dans la phrase (と de citation, 〜てもいい). */
  sentence?: { tokens: KuromojiToken[]; index: number };
  status: ItemStatus;
  onAction: (a: StatusAction) => void;
  onClose: () => void;
}) {
  const reading = token.reading ? kataToHira(token.reading) : "";
  const content = isContent(token);
  const around = sentence ?? { tokens: [token], index: 0 };
  const points = useMemo(() => grammarPointsAt(around.tokens, around.index), [around.tokens, around.index]);
  const [mnemonic, setMnemonic] = useState<Mnemonic | undefined>(undefined);
  const [encounter, setEncounter] = useState<ReEncounter | null>(null);
  // Pile référentielle empilée sur la vue du token : kanji du mot → mot lié → kanji…
  const nav = useRefStack();

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

  // Les fiches kanji / mot liés remplacent la vue mot DANS la même feuille (rangée retour
  // en tête) : plus d'empilement de modales.
  return (
    <BottomSheet
      onClose={onClose}
      resetKey={nav.key}
      ariaLabel={nav.top ? refAria(nav.top) : `Fiche du mot ${token.surface_form}`}
    >
      {nav.top ? (
        <>
          <BackRow
            label={nav.below ? refLabel(nav.below) : token.surface_form}
            onClick={nav.back}
          />
          <RefStackView
            view={nav.top}
            below={nav.below}
            rootVocabId={itemIdFor(token)}
            onPush={nav.push}
          />
        </>
      ) : (
        <>
      <div className="flex items-baseline gap-3">
        <span className="font-jp text-xl">{token.surface_form}</span>
        {reading && reading !== token.surface_form && (
          <span className="text-lg text-muted">{reading}</span>
        )}
        <button
          className="cursor-pointer self-center rounded-sm border border-hairline px-2 py-1 leading-none transition-colors hover:border-accent"
          onClick={() => speakWord(wordSpeechText(token.surface_form, reading))}
          aria-label="Écouter le mot"
          title="Écouter"
        >
          <IconSpeaker size={16} />
        </button>
        <span className="ml-auto font-sans text-xs uppercase tracking-wider text-muted">
          {token.pos === "名詞" && token.pos_detail_1 === "固有名詞"
            ? "nom propre"
            : (POS_FR[token.pos] ?? token.pos)}
        </span>
      </div>

      {/* Un morphème se glose par son rôle (は → [thème]), comme dans le gloss du Lecteur : le
          dictionnaire n'en connaît que les homographes (歯 « dent », 二 « deux »). */}
      <div className="text-lg">
        {content ? meaningFor(token) : glossAt(around.tokens, around.index, contentDictSnapshot()).gloss}
      </div>
      {/* Un mot non suivi n'a pas de statut : « jamais marqué » ne dirait rien. */}
      {content && <div className="text-sm text-muted">Statut : {STATUS_FR[status]}</div>}
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
              <span className="text-text">
                <Emphasis text={mnemonic.story} />
              </span>
            </span>
          )}
          {mnemonic.composition && (
            <span>
              <span className="text-muted">Composition :</span>{" "}
              <span className="text-text">
                <Emphasis text={mnemonic.composition} />
              </span>
            </span>
          )}
        </div>
      )}

      <KanjiBreakdown
        surface={token.basic_form || token.surface_form}
        reading={reading}
        onOpenKanji={(ch) => nav.push({ kind: "kanji", ch })}
      />

      {/* Un mot de contenu peut porter un point (ある, この, l'adjectif devant un nom). */}
      {content && points.length > 0 && <GrammarPoints points={points} />}

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
        <>
          <p className="text-sm text-muted">{untrackedReason(token, points.length > 0)}</p>
          {points.length > 0 && <GrammarPoints points={points} />}
        </>
      )}
        </>
      )}
    </BottomSheet>
  );
}
