// Section « Kanji du mot » : décomposition d'une surface en kanji, chaque rangée
// ouvrant la fiche du kanji (KanjiSheet). Rendue dans WordSheet et VocabPeekSheet.

import { kanjiBreakdown } from "../lib/kanjiInfo";
import { Badge } from "./kit/Badge";

export function KanjiBreakdown({
  surface,
  onOpenKanji,
}: {
  surface: string;
  onOpenKanji: (ch: string) => void;
}) {
  const items = kanjiBreakdown(surface);
  if (items.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wider text-muted">Kanji du mot</p>
      <ul className="flex list-none flex-col border-b border-hairline">
        {items.map((k) => (
          <li key={k.id}>
            <button
              className="flex w-full min-h-11 cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline py-2 text-left transition-colors hover:border-accent"
              onClick={() => onOpenKanji(k.id)}
              aria-label={`Ouvrir la fiche du kanji ${k.ja}`}
            >
              <span className="font-jp text-lg text-text">{k.ja}</span>
              <span className="font-jp text-sm text-muted">
                {[...k.kun, ...k.on].slice(0, 4).join("・")}
              </span>
              <span className="grow font-sans text-sm text-text">{k.fr}</span>
              <Badge>N{k.level}</Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
