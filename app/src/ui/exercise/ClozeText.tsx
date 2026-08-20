/** Sentinelles de trou posées par la génération d'exercices : `◯◯` pour un mot masqué
 *  (exerciseBuild) et `＿` pour une particule à replacer (exam). Ce sont des marqueurs de
 *  DONNÉES — jamais ce que l'utilisateur doit voir : les glyphes ronds se lisaient comme
 *  deux mots à trouver, là où le trou est unique. */
const BLANK_SPLIT = /(◯+|＿+)/;

/** Découpe un texte en segments alternés : texte, trou, texte… Les indices impairs sont
 *  les trous (contrat de `String.split` avec un groupe capturant). Exporté pour le test. */
export function clozeParts(text: string): string[] {
  return text.split(BLANK_SPLIT);
}

/** Vrai si le texte porte un trou — un cloze est une PHRASE, jamais un mot isolé (cf. la
 *  typographie de JpFront). */
export function hasBlank(text: string): boolean {
  return /◯|＿/.test(text);
}

/**
 * Le trou lui-même : un filet unique posé sur la ligne de base, à la place du mot ou de la
 * particule manquants. Un seul filet = une seule chose à trouver ; sa largeur dit laquelle
 * (un mot occupe plus de place qu'une particule) sans jamais souffler la réponse.
 */
function Blank({ wide }: { wide: boolean }) {
  return (
    <span
      role="img"
      aria-label={wide ? "mot à trouver" : "particule à trouver"}
      // `align-baseline` pose le filet sur la ligne de base LATINE ; les glyphes japonais
      // descendent plus bas, d'où la translation qui le ramène au pied des kana.
      className={`mx-[0.12em] inline-block h-[0.2em] translate-y-[0.1em] border-b-2 border-accent align-baseline ${
        wide ? "w-[2.2em]" : "w-[1.1em]"
      }`}
    />
  );
}

/** Texte d'exercice avec ses trous rendus en filets. Sans trou, rend le texte tel quel. */
export function ClozeText({ text }: { text: string }) {
  if (!hasBlank(text)) return <>{text}</>;
  return (
    <>
      {clozeParts(text).map((part, i) =>
        i % 2 === 1 ? (
          <Blank key={i} wide={part.startsWith("◯")} />
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
