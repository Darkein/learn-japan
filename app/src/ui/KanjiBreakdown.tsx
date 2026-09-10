// Section « Kanji du mot » : décomposition d'une surface en kanji. Rendue dans WordSheet,
// VocabPeekDetail et la correction d'un exercice (WordFeedback). Sans `onOpenKanji` les
// rangées sont statiques : dans une carte d'exercice il n'y a pas de fiche à ouvrir, et
// un bouton qui ne mène nulle part se tapote pour rien.

import { kanjiBreakdown, wordKanjiReadings } from "../lib/kanjiInfo";
import { partsSummary } from "../lib/kanjiParts";
import { Badge } from "./kit/Badge";

const ROW = "flex w-full min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline py-2 text-left";

/**
 * Lectures montrées par rangée. Un kanji en porte jusqu'à une douzaine — les aligner
 * toutes noierait la rangée et pousserait le sens hors écran. `reading` décide LESQUELLES :
 * sans lui la liste reste celle du référentiel, tronquée en aveugle (cf. wordKanjiReadings).
 */
const READINGS_SHOWN = 4;

export function KanjiBreakdown({
  surface,
  reading,
  onOpenKanji,
  showParts,
}: {
  surface: string;
  /** Lecture du mot d'où l'on vient : sert à montrer d'abord la lecture à l'œuvre ICI. */
  reading?: string;
  onOpenKanji?: (ch: string) => void;
  /**
   * Ajoute sous chaque rangée la composition du kanji (« 目 œil + 儿 jambes »). Réservé au
   * moment d'étude (correction d'exercice) : dans une feuille de mot, la fiche kanji est à
   * un tap et porte la version détaillée.
   */
  showParts?: boolean;
}) {
  const items = kanjiBreakdown(surface);
  if (items.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wider text-muted">Kanji du mot</p>
      <ul className="flex list-none flex-col border-b border-hairline">
        {items.map((k) => {
          const body = (
            <>
              <span className="font-jp text-lg text-text">{k.ja}</span>
              <span className="font-jp text-sm text-muted">
                {wordKanjiReadings(k, surface, reading).slice(0, READINGS_SHOWN).join("・")}
              </span>
              <span className="grow font-sans text-sm text-text">{k.fr}</span>
              <Badge>N{k.level}</Badge>
            </>
          );
          const parts = showParts ? partsSummary(k.id) : "";
          return (
            <li key={k.id}>
              {onOpenKanji ? (
                <button
                  className={`${ROW} cursor-pointer transition-colors hover:border-accent`}
                  onClick={() => onOpenKanji(k.id)}
                  aria-label={`Ouvrir la fiche du kanji ${k.ja}`}
                >
                  {body}
                </button>
              ) : (
                <div className={ROW}>{body}</div>
              )}
              {/* Composition sur SA propre ligne : la rangée porte déjà lectures + sens +
                  niveau, l'y glisser la ferait passer à la ligne n'importe où. */}
              {parts && <p className="m-0 pb-2 text-xs text-muted">{parts}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
