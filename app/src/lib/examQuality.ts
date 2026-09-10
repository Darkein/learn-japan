// Deux défauts qu'un sujet de contrôle ne doit jamais présenter, et que ni le tirage
// déterministe (lib/exam.ts) ni le Worker ne garantissent seuls :
//
//   - la RÉPONSE DANS L'ÉNONCÉ — « ある (exister, inanimé) : quel est son rôle ? » avec
//     « Existence d'objets inanimés » parmi les options. La question se coche sans rien
//     savoir : ce n'est plus une question ;
//   - DEUX FOIS LA MÊME QUESTION — la section « Règle » demande le rôle de を, et le QCM de
//     cours produit par le Worker redemande « que marque を ? » trois questions plus loin.
//     Un contrôle qui ressasse mesure une seule chose et la compte deux fois.
//
// Les deux se ramènent à comparer deux textes FRANÇAIS par leur CONTENU, pas par leurs
// mots : « Existence d'objets inanimés » et « exister, inanimé » ne partagent aucun mot
// exact. D'où la réduction en RADICAUX grossiers (accents retirés, mots-outils écartés,
// troncature à `STEM_LEN`) — pas de la lexicographie, juste assez pour que « existence » et
// « exister » se reconnaissent. Les formes japonaises citées sont ignorées : が dans
// « X がある » n'est pas un indice, c'est la règle elle-même.
//
// Module PUR (aucun accès base, aucun aléa) : les seuils sont fixés ici et les tests les
// tiennent.

/** Longueur du radical grossier : « existence » et « exister » → « exist ». */
const STEM_LEN = 5;

/** Radicaux trop courts pour porter du sens une fois tronqués (« est » → « est »). */
const MIN_WORD_LEN = 3;

/**
 * Mots-outils français : présents dans presque toutes les phrases, ils feraient se
 * ressembler deux questions qui n'ont rien en commun. La liste est volontairement courte —
 * la troncature et `MIN_WORD_LEN` filtrent déjà le gros du bruit.
 */
const STOPWORDS = new Set([
  "au", "aux", "avec", "car", "ce", "ces", "cet", "cette", "ceux", "chaque", "comme",
  "dans", "de", "des", "du", "elle", "elles", "en", "est", "et", "eux", "il", "ils",
  "je", "la", "le", "les", "leur", "lui", "ma", "mais", "me", "mes", "moi", "mon", "ne",
  "nos", "notre", "nous", "on", "ou", "par", "pas", "peu", "plus", "pour", "quand",
  "que", "quel", "quelle", "quelles", "quels", "qui", "sa", "sans", "se", "ses", "son",
  "sont", "sur", "ta", "te", "tes", "toi", "ton", "tu", "un", "une", "vos", "votre",
  "vous", "y",
]);

/**
 * Mots du VOCABULAIRE DE L'ÉNONCÉ, communs à toute question de grammaire (« quel est le
 * rôle de ce point de grammaire ? », « que marque cette particule ? »). Ils ne sont pas
 * des mots-outils — ils portent du sens — mais deux questions qui ne partagent qu'eux ne se
 * ressemblent pas pour autant.
 */
const QUESTION_WORDS = new Set([
  "role", "point", "gramm", "parti", "phras", "texte", "propo", "signi",
]);

/** Accents retirés, minuscules, tout ce qui n'est pas lettre latine devient séparateur. */
function asciiFold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * Radicaux porteurs de sens d'un texte français. Les caractères japonais disparaissent au
 * pliage (`asciiFold` ne garde que les lettres latines) : une règle qui cite « X がある »
 * n'est comparée que sur son français.
 */
export function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of asciiFold(text).split(" ")) {
    if (word.length < MIN_WORD_LEN || STOPWORDS.has(word)) continue;
    const stem = word.slice(0, STEM_LEN);
    if (!QUESTION_WORDS.has(stem)) out.add(stem);
  }
  return out;
}

/**
 * Recouvrement de deux jeux de radicaux, rapporté au PLUS PETIT : une reformulation courte
 * (« Que marque を ? ») doit se reconnaître dans une règle longue qui la contient. Zéro
 * quand l'un des deux est vide.
 */
export function stemOverlap(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let hits = 0;
  for (const stem of small) if (large.has(stem)) hits++;
  return hits / small.size;
}

/** Signature d'une question : son énoncé (face avant comprise) et sa bonne réponse. */
export interface QuestionSignature {
  /** L'énoncé tel qu'il se lit : face avant ET consigne. Les options n'en font pas partie —
   *  ce sont les réponses candidates, pas la question. */
  prompt: string;
  /** La bonne réponse, en clair. */
  answer: string;
}

/** Part des radicaux de la réponse déjà présents dans l'énoncé au-delà de laquelle la
 *  question se coche sans rien savoir. */
const LEAK_RATIO = 0.6;

/** En deçà, la réponse est trop courte pour qu'un recouvrement veuille dire quoi que ce
 *  soit (« Oui. » partage tout avec n'importe quoi). */
const LEAK_MIN_STEMS = 2;

/**
 * La bonne réponse est-elle DÉJÀ DANS L'ÉNONCÉ ? Vrai quand l'essentiel de ce que dit la
 * réponse se lit déjà dans la question — le cas du nom de point de grammaire glosé en
 * français (« ある (exister, inanimé) » ⇒ « Existence d'objets inanimés »).
 */
export function answerInQuestion(sig: QuestionSignature): boolean {
  const answer = contentStems(sig.answer);
  if (answer.size < LEAK_MIN_STEMS) return false;
  const prompt = contentStems(sig.prompt);
  let hits = 0;
  for (const stem of answer) if (prompt.has(stem)) hits++;
  return hits / answer.size >= LEAK_RATIO;
}

/** Deux énoncés qui se recouvrent à ce point posent la même question. Seuil HAUT : deux
 *  questions de compréhension sur le même personnage partagent déjà beaucoup de mots
 *  (« que fait Yuki le matin ? » / « … le soir ? ») sans faire double emploi. */
const SAME_PROMPT = 0.8;
/** Deux bonnes réponses qui se recouvrent à ce point disent la même chose — quels que
 *  soient les mots de l'énoncé, la question a déjà été posée. */
const SAME_ANSWER = 0.8;
/** En deçà, les jeux de radicaux sont trop maigres pour conclure à un doublon. */
const SAME_MIN_STEMS = 3;

/**
 * Deux questions font-elles double emploi ? Deux critères indépendants, parce que le
 * ressassement prend deux formes : le même énoncé reformulé, ou deux énoncés différents
 * dont la bonne réponse dit la même chose (« quel est le rôle de を ? » et « que marque
 * を ? » appellent tous deux « le complément d'objet direct »).
 */
export function isDuplicateQuestion(a: QuestionSignature, b: QuestionSignature): boolean {
  const answerA = contentStems(a.answer);
  const answerB = contentStems(b.answer);
  if (
    Math.min(answerA.size, answerB.size) >= SAME_MIN_STEMS &&
    stemOverlap(answerA, answerB) >= SAME_ANSWER
  ) {
    return true;
  }
  const promptA = contentStems(a.prompt);
  const promptB = contentStems(b.prompt);
  return (
    Math.min(promptA.size, promptB.size) >= SAME_MIN_STEMS &&
    stemOverlap(promptA, promptB) >= SAME_PROMPT
  );
}

/**
 * Retient d'une série de questions celles qui APPORTENT quelque chose : ni la réponse dans
 * l'énoncé, ni un doublon d'une question déjà retenue (`already`, les sections
 * déterministes du sujet) ou d'une précédente de la série. L'ordre est conservé — la
 * première formulation gagne, la reformulation tombe.
 */
export function keepDistinct<T>(
  items: readonly T[],
  signature: (item: T) => QuestionSignature,
  already: readonly QuestionSignature[] = [],
): T[] {
  const kept: QuestionSignature[] = [...already];
  const out: T[] = [];
  for (const item of items) {
    const sig = signature(item);
    if (answerInQuestion(sig)) continue;
    if (kept.some((k) => isDuplicateQuestion(k, sig))) continue;
    kept.push(sig);
    out.push(item);
  }
  return out;
}
