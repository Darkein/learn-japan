import { hasJapanese } from "../../lib/kana";
import { ClozeText, hasBlank } from "./ClozeText";

/** Au-delà, ce n'est plus un mot mais une phrase : le très grand format la ferait déborder. */
const WORD_MAX = 6;
/** Au-delà, un sens FR n'est plus une étiquette mais une définition (le référentiel
 *  désambiguïse les glosses : « contenu, ce qu'il y a à l'intérieur (graphie courante) »).
 *  En text-3xl elle mangeait quatre lignes et repoussait les options hors de l'écran. */
const GLOSS_MAX = 28;

/**
 * Face avant d'un exercice — elle porte sa propre typographie, les appelants n'ont rien à
 * décider. Un MOT japonais isolé est rendu en très grand : c'est la forme qu'on mémorise,
 * et la reconnaissance d'un kanji tient à ses traits, que du texte de corps écrase. Les
 * phrases japonaises (cloze, dictée) restent lisibles à taille normale, et une face
 * française prend la sérif latine — `font-jp` lui donnait une Noto Serif JP incongrue.
 * Un texte à trou est une phrase par nature : il ne passe jamais en format « mot », même
 * court (« ◯◯が走る。 » tenait sous WORD_MAX et s'affichait en text-6xl, trou compris).
 */
export function JpFront({ text }: { text: string }) {
  if (!text) return null; // exercice à l'aveugle (écoute) : rien à montrer avant la réponse
  const len = [...text].length;
  const cls = !hasJapanese(text)
    ? len <= GLOSS_MAX
      ? "font-serif text-3xl"
      : "font-serif text-2xl"
    : len <= WORD_MAX && !hasBlank(text)
      ? "font-jp text-6xl leading-tight sm:text-7xl"
      : "font-jp text-2xl";
  return (
    <div className={cls}>
      <ClozeText text={text} />
    </div>
  );
}
