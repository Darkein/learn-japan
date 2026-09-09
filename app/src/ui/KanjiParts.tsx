// Section « Composants » de la fiche kanji : de quelles parties le tracé est fait, laquelle
// est le radical, laquelle donne la lecture. À ne pas confondre avec KanjiBreakdown, qui
// décompose un MOT en kanji — ici on descend du kanji vers ses parties (lib/kanjiParts.ts).
//
// Rangées statiques : pas de navigation vers la fiche d'un composant, DESIGN.md proscrit
// l'empilement de feuilles. Rien ne s'affiche si la composition n'est pas connue — l'absence
// d'entrée dit « on ne sait pas », jamais « ce kanji est simple ».

import { kanjiDetail } from "../lib/inventory";
import { isSelfRadical, kanjiParts } from "../lib/kanjiParts";

const ROW =
  "flex w-full min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-hairline py-2 text-left";

export function KanjiParts({ ch }: { ch: string }) {
  const parts = kanjiParts(ch);
  if (parts.length === 0) return null;

  // La mention de la lecture n'est posée que si le kanji n'en a qu'UNE en on : avec
  // plusieurs, rien ne dit laquelle le composant phonétique porte, et nommer la première
  // enseignerait un faux.
  const on = kanjiDetail(ch)?.on ?? [];
  const phoneticHint = on.length === 1 ? `donne la lecture ${on[0]}` : "donne la lecture";

  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wider text-muted">Composants</p>
      <ul className="flex list-none flex-col border-b border-hairline">
        {parts.map((p, i) => (
          <li key={`${p.ja}-${i}`} className={ROW}>
            <span className="font-jp text-lg text-text">{p.ja}</span>
            <span className="grow font-sans text-sm text-text">{p.fr}</span>
            {p.radical && <span className="text-xs text-muted">radical</span>}
            {p.phonetic && <span className="text-xs text-muted">{phoneticHint}</span>}
          </li>
        ))}
      </ul>
      {isSelfRadical(ch) && (
        <p className="m-0 text-xs text-muted">
          <span className="font-jp">{ch}</span> est lui-même un radical.
        </p>
      )}
    </div>
  );
}
