// Triangle de révision d'un mot (SPEC §5) : kanji ↔ furigana ↔ traduction. Un mot se
// révise depuis n'importe laquelle de ses faces vers n'importe quelle autre — six
// directions au plus. Le MODE d'entrée dépend de la face CIBLE et de la maîtrise :
//   - cible « kana »  : QCM tant que le mot n'est pas su, saisie ensuite ;
//   - cible « kanji » : toujours QCM — le champ de saisie convertit romaji → kana
//                       (wanakana), on ne peut pas y taper de kanji ;
//   - cible « fr »    : toujours QCM — les synonymes rendraient la saisie injuste.
// Module pur (pas d'accès à la base) : voir exerciseBuild.vocabTriangleExercise pour la
// construction de l'exercice lui-même.

import type { VocabItem } from "./db";
import { hasKanji, normalizeReading } from "./kana";
import { weightedShuffle } from "./random";

export type Face = "kanji" | "kana" | "fr";

export interface Direction {
  from: Face;
  to: Face;
}

/** Réussites consécutives (`VocabItem.streak`) à partir desquelles on passe en saisie. */
export const TYPE_STREAK = 2;

const ALL_FACES: Face[] = ["kanji", "kana", "fr"];

/**
 * Contenu de la face, ou null si le mot ne la porte pas :
 *  - `kanji` : seulement si la graphie a un kanji ET diffère de sa lecture (sinon la face
 *    ferait doublon avec `kana` et l'exercice serait une recopie) ;
 *  - `fr` : seulement si le sens est exploitable (« — » = sens inconnu, cf. `meaningFor`).
 */
export function faceText(v: VocabItem, face: Face): string | null {
  if (face === "kanji") {
    const distinct = normalizeReading(v.surface) !== normalizeReading(v.reading);
    return hasKanji(v.surface) && distinct ? v.surface : null;
  }
  if (face === "kana") return v.reading || null;
  return v.meaning && v.meaning !== "—" ? v.meaning : null;
}

/** Faces réellement portées par le mot (2 ou 3 ; `isTrainableVocab` écarte les mots à 1). */
export function availableFaces(v: VocabItem): Face[] {
  return ALL_FACES.filter((f) => faceText(v, f) !== null);
}

/**
 * Item testable : un sens FR exploitable, ou une graphie ≠ lecture. Sinon (mot kana sans
 * sens — nom d'un personnage inventé, onomatopée hors dico) le front de l'exercice EST la
 * réponse : recopie sans intérêt. Un tel mot ne doit apparaître nulle part en révision,
 * pas même comme DISTRACTEUR (cf. faceDistractors) ni dans le rappel du soir.
 */
export function isTrainableVocab(v: VocabItem): boolean {
  return (!!v.meaning && v.meaning !== "—") || normalizeReading(v.surface) !== normalizeReading(v.reading);
}

/** Toutes les paires ordonnées de faces distinctes : 6 pour un mot complet, 2 sinon. */
export function directionsFor(v: VocabItem): Direction[] {
  const faces = availableFaces(v);
  const out: Direction[] = [];
  for (const from of faces) {
    for (const to of faces) {
      if (from !== to) out.push({ from, to });
    }
  }
  return out;
}

/** Clé stable d'une direction, telle que stockée dans `VocabItem.lastDir`. */
export function dirKey(d: Direction): string {
  return `${d.from}>${d.to}`;
}

/**
 * Combien de fois plus souvent une direction qui fait intervenir la face KANJI passe devant
 * une direction purement kana (lecture ↔ sens). La graphie est ce qui coûte à apprendre :
 * un mot qui porte des kanji se révise sur ses kanji, pas sur sa transcription en kana.
 * Pondération, pas exclusion — les directions kana restent tirables (et sont les seules
 * d'un mot sans face kanji).
 */
export const KANJI_WEIGHT = 4;

/** Une direction « travaille » le kanji dès qu'elle le montre (from) ou le demande (to). */
export function involvesKanji(d: Direction): boolean {
  return d.from === "kanji" || d.to === "kanji";
}

/**
 * Ordre de tirage des directions : mélangées EN FAVEUR du kanji (cf. KANJI_WEIGHT), celle du
 * passage précédent reléguée en dernier. Deux révisions d'affilée sous le même angle
 * n'apprennent rien de plus que la première — mais on la garde en repli, car une direction
 * n'est pas toujours constructible (pool de distracteurs trop pauvre) : l'appelant descend la
 * liste jusqu'à ce qu'une passe.
 */
export function orderDirections(dirs: Direction[], lastDir?: string): Direction[] {
  const fresh = weightedShuffle(
    dirs.filter((d) => dirKey(d) !== lastDir),
    (d) => (involvesKanji(d) ? KANJI_WEIGHT : 1),
  );
  const stale = dirs.filter((d) => dirKey(d) === lastDir);
  return [...fresh, ...stale];
}

/**
 * Mode d'entrée pour une face cible. Un élément difficile (`isLeech`, ≥ SRS.leechLapses
 * échecs) repasse au QCM même s'il avait atteint le seuil : la saisie sur un mot qu'on
 * rate en boucle n'est qu'une occasion d'échouer de plus.
 */
export function pickInputMode(to: Face, streak = 0, isLeech = false): "choice" | "type" {
  return to === "kana" && !isLeech && streak >= TYPE_STREAK ? "type" : "choice";
}

/** Consigne affichée au-dessus de la face avant, selon la face demandée. */
export function promptFor(to: Face, mode: "choice" | "type"): string {
  if (to === "kanji") return "Quelle est l'écriture de ce mot ?";
  if (to === "fr") return "Que signifie ce mot ?";
  return mode === "type" ? "Écris la lecture en kana" : "Quelle est la lecture ?";
}
