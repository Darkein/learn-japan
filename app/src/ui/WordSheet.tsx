import { kataToHira } from "../lib/kana";
import type { ItemStatus } from "../lib/db";
import { isContent, meaningFor, type StatusAction } from "../lib/vocab";
import type { KuromojiToken } from "../lib/tokenizer";
import styles from "./WordSheet.module.css";

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

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className={styles.head}>
          <span className={styles.surface}>{token.surface_form}</span>
          {reading && reading !== token.surface_form && (
            <span className={styles.reading}>{reading}</span>
          )}
          <span className={`meta ${styles.pos}`}>{POS_FR[token.pos] ?? token.pos}</span>
        </div>

        <div className={styles.meaning}>{meaningFor(token)}</div>
        <div className={styles.statusLine}>Statut : {STATUS_FR[status]}</div>

        {content ? (
          <div className={styles.actions}>
            {ACTIONS.map((a) => (
              <button key={a.id} className={styles.action} onClick={() => onAction(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.note}>
            Morphème grammatical — suivi dans la piste grammaire (à venir), pas en vocabulaire.
          </p>
        )}
      </div>
    </div>
  );
}
