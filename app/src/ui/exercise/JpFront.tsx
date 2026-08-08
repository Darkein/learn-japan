import { hasJapanese } from "../../lib/kana";

/** Au-delà, ce n'est plus un mot mais une phrase : le très grand format la ferait déborder. */
const WORD_MAX = 6;

/**
 * Face avant d'un exercice — elle porte sa propre typographie, les appelants n'ont rien à
 * décider. Un MOT japonais isolé est rendu en très grand : c'est la forme qu'on mémorise,
 * et la reconnaissance d'un kanji tient à ses traits, que du texte de corps écrase. Les
 * phrases japonaises (cloze, dictée) restent lisibles à taille normale, et une face
 * française prend la sérif latine — `font-jp` lui donnait une Noto Serif JP incongrue.
 */
export function JpFront({ text }: { text: string }) {
  const ja = hasJapanese(text);
  const cls = !ja
    ? "font-serif text-3xl"
    : [...text].length <= WORD_MAX
      ? "font-jp text-6xl leading-tight sm:text-7xl"
      : "font-jp text-2xl";
  return <div className={cls}>{text}</div>;
}
