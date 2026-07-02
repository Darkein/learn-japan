// Tirages aléatoires partagés (Fisher-Yates). Une seule implémentation pour toute l'app :
// distracteurs de quiz, échantillons de révision, mélange des tuiles et des options de QCM.

/** Mélange (Fisher-Yates) — renvoie une copie, l'entrée n'est pas modifiée. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tire `n` éléments au hasard dans `arr`, sans dépasser sa taille. */
export function sample<T>(arr: readonly T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

/** Mélange en renvoyant aussi le nouvel index d'un élément suivi (ex. la bonne réponse d'un QCM). */
export function shuffleTracking<T>(items: readonly T[], trackedIndex: number): { items: T[]; index: number } {
  const arr = [...items];
  let tracked = trackedIndex;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
    if (i === tracked) tracked = j;
    else if (j === tracked) tracked = i;
  }
  return { items: arr, index: tracked };
}
