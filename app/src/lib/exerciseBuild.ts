// Construit des `Exercise` (lib/exercise.ts). Cœur du fichier : le TRIANGLE de révision
// du vocabulaire (kanji ↔ furigana ↔ traduction, cf. lib/vocabFaces.ts), servi aussi bien
// en révision SRS que sur une leçon ou une histoire. À côté : les variantes d'écoute et de
// production, la carte de grammaire et la reconstruction de phrase.
// Pas de logique de notation ici (voir gradeExercise).

import { toTiles, shuffleTiles } from "./builder";
import type { GrammarItem, VocabItem } from "./db";
import type { ChoiceExercise, BuildExercise, Exercise, TypeExercise } from "./exercise";
import { grammarLessonOrder } from "./curriculum";
import { allGrammarInv, grammarDetail } from "./inventory";
import { answerVariants, normalizeReading } from "./kana";
import { shuffle } from "./random";
import { wordSpeechText } from "./speech";
import { tokenize, type KuromojiToken } from "./tokenizer";
import { effectiveExample } from "./vocab";
import {
  dirKey,
  directionsFor,
  faceText,
  orderDirections,
  pickInputMode,
  promptFor,
  type Direction,
  type Face,
} from "./vocabFaces";

/** Nombre de distracteurs d'un QCM (soit 4 options en tout). */
const CHOICES = 3;

/**
 * Mots du pool qui portent EXACTEMENT le même sens FR que `v` : depuis la face française,
 * rien ne les distingue (« oui » → はい ou ええ). Le référentiel curé n'en produit aucun —
 * chaque gloss FR y désigne un seul mot, et inventory.test.ts le vérifie — mais un mot
 * rencontré dans le Lecteur tire son sens du JMdict, non curé : le doublon reste possible.
 * Les jumeaux servent alors à rendre la question honnête plutôt qu'à la supprimer :
 * exclus des distracteurs d'un QCM (deux bonnes réponses), acceptés en saisie.
 */
function frTwins(pool: VocabItem[], v: VocabItem): VocabItem[] {
  const fr = faceText(v, "fr");
  if (!fr) return [];
  return pool.filter((p) => p.id !== v.id && faceText(p, "fr") === fr);
}

/**
 * Distracteurs tirés sur LA MÊME face que la réponse : des graphies contre une graphie,
 * des lectures contre une lecture, des sens contre un sens. Un QCM qui mélange les
 * registres se résout sans connaître le mot. Les items du même niveau JLPT passent
 * d'abord : un distracteur trop éloigné du niveau s'élimine tout seul.
 * `excluded` écarte les mots dont la réponse serait AUSSI juste que la bonne (jumeaux de
 * sens, quand la question part de la face française).
 */
function faceDistractors(
  pool: VocabItem[],
  v: VocabItem,
  face: Face,
  answer: string,
  excluded: Set<string> = new Set(),
): string[] {
  const seen = new Set<string>([answer]);
  const same: string[] = [];
  const other: string[] = [];
  for (const p of pool) {
    if (p.id === v.id || excluded.has(p.id)) continue;
    const text = faceText(p, face);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    (p.jlpt !== undefined && p.jlpt === v.jlpt ? same : other).push(text);
  }
  return [...shuffle(same), ...shuffle(other)].slice(0, CHOICES);
}

/** Champs communs à toutes les cartes du triangle, quelle que soit la direction. */
function triangleBase(v: VocabItem, dir: Direction, due: number, mode: "choice" | "type") {
  const example = effectiveExample(v);
  const hasMeaning = !!v.meaning && v.meaning !== "—";
  return {
    key: `vocab:${v.id}:${dirKey(dir)}`,
    track: "vocab" as const,
    skill: "written" as const,
    id: v.id,
    front: faceText(v, dir.from)!,
    back: `${v.surface}（${v.reading}）`,
    ...(hasMeaning ? { meaning: v.meaning } : {}),
    word: { id: v.id, surface: v.surface, reading: v.reading },
    prompt: promptFor(dir.to, mode),
    due,
    audioBack: { word: wordSpeechText(v.surface, v.reading) },
    ...(example?.ja ? { context: example.ja } : {}),
    ...(example?.fr ? { contextFr: example.fr } : {}),
  };
}

/**
 * Saisie de la lecture : la seule cible typable (le champ convertit romaji → kana).
 * `twins` = mots indistinguables depuis la face française (cf. frTwins) : leur lecture est
 * acceptée elle aussi, sans quoi « oui » attendrait はい et compterait ええ pour une faute.
 */
function readingTypeExercise(
  v: VocabItem,
  dir: Direction,
  due: number,
  twins: VocabItem[] = [],
): TypeExercise {
  return {
    ...triangleBase(v, dir, due, "type"),
    mode: "type",
    // La graphie est acceptée en plus de la lecture : un apprenant qui tape 日本 plutôt
    // que にほん connaît le mot, ce n'est pas le moment de lui compter une faute.
    answers: answerVariants(v.reading, v.surface, ...twins.flatMap((t) => [t.reading, t.surface])),
  };
}

/** Une direction donnée, ou null si elle n'est pas constructible (pool trop pauvre). */
function triangleDirection(
  v: VocabItem,
  dir: Direction,
  due: number,
  pool: VocabItem[],
  isLeech: boolean,
): Exercise | null {
  const answer = faceText(v, dir.to);
  if (!answer || !faceText(v, dir.from)) return null;

  // Partir du sens FR, c'est demander un mot que seule cette définition désigne : les
  // jumeaux de sens sont écartés du QCM et acceptés en saisie (cf. frTwins).
  const twins = dir.from === "fr" ? frTwins(pool, v) : [];

  if (pickInputMode(dir.to, v.streak ?? 0, isLeech) === "type")
    return readingTypeExercise(v, dir, due, twins);

  const distractors = faceDistractors(pool, v, dir.to, answer, new Set(twins.map((t) => t.id)));
  if (distractors.length < CHOICES) {
    // Pas assez de distracteurs plausibles : plutôt que de servir un QCM à deux options
    // (devinable à pile ou face), on demande la lecture en saisie quand c'est la cible.
    return dir.to === "kana" ? readingTypeExercise(v, dir, due, twins) : null;
  }
  const { choices, answerIndex } = shuffleWithAnswer(answer, distractors);
  return { ...triangleBase(v, dir, due, "choice"), mode: "choice", choices, answerIndex };
}

/**
 * Carte du triangle kanji ↔ furigana ↔ traduction — LE format de révision du vocabulaire
 * écrit (révision SRS, bilan de leçon, exercices d'histoire). La direction est tirée au
 * hasard parmi celles que le mot porte, en évitant celle du passage précédent ; le mode
 * suit la face cible et la suite de réussites (QCM tant que ce n'est pas su, saisie de la
 * lecture ensuite).
 *
 * EFFET DE BORD : met à jour `v.lastDir`. L'appelant doit persister `v` (`putVocab`) pour
 * que le prochain tirage évite bien la direction qui vient d'être servie.
 */
export function vocabTriangleExercise(
  v: VocabItem,
  due: number,
  pool: VocabItem[],
  opts: { isLeech?: boolean } = {},
): Exercise {
  const dirs = orderDirections(directionsFor(v), v.lastDir);
  for (const dir of dirs) {
    const ex = triangleDirection(v, dir, due, pool, opts.isLeech ?? false);
    if (ex) {
      v.lastDir = dirKey(dir);
      return ex;
    }
  }
  // Filet : `directionsFor` porte toujours une direction vers `kana`, et celle-ci est
  // toujours constructible (repli saisie) — on ne passe donc jamais ici, sauf mot à une
  // seule face que `isTrainableVocab` aurait laissé filer.
  const from: Face = faceText(v, "fr") ? "fr" : "kanji";
  const fallback: Direction = { from, to: "kana" };
  v.lastDir = dirKey(fallback);
  return readingTypeExercise(v, fallback, due);
}

/**
 * Occurrence du mot dans sa phrase d'exemple : graphie, lecture, ou FORME RENCONTRÉE
 * (radical conjugué porté par l'id, ex. « し » pour する|し) — la phrase d'une histoire
 * contient la forme conjuguée, pas la forme de dictionnaire stockée depuis
 * newVocabItemFromToken. Null si le mot n'apparaît sous aucune forme.
 */
function exampleHit(v: VocabItem, ja?: string): string | null {
  if (!ja) return null;
  if (ja.includes(v.surface)) return v.surface;
  if (ja.includes(v.reading)) return v.reading;
  const stem = v.id.split("|")[1];
  if (stem && stem !== v.reading && ja.includes(stem)) return stem;
  return null;
}

/** Réponses acceptées quand la phrase masque `hit` : la forme masquée doit toujours
    être acceptée telle quelle (taper « し » dans 宿題を◯◯ます。 est LA bonne réponse,
    même si la carte porte する). */
function answersWithHit(answers: string[], hit: string | null): string[] {
  if (!hit) return answers;
  const norm = normalizeReading(hit);
  return answers.includes(norm) ? answers : [...answers, norm];
}

/**
 * Carte vocabulaire en saisie active sur une compétence AUTRE que l'écrit — l'écrit passe
 * par `vocabTriangleExercise`. La variante est obligatoire :
 * `produce` : production en contexte (carte `production`) — cloze ◯◯ sur la phrase
 * d'exemple avec la traduction FR en indice ; sans exemple exploitable, retombe sur le
 * rappel isolé FR → mot, toujours noté sur la compétence production.
 * `listen` : écoute — la phrase d'exemple est jouée, l'utilisateur tape le mot entendu. Le
 * mot cible est masqué (◯◯) dans la phrase affichée quand il s'y trouve tel quel.
 * `listen` + `silent` : remplacement écrit de l'écoute (réglage « sans le son ») — cloze
 * de production sur la phrase d'exemple, mais noté sur la carte ORALE pour que sa
 * planification continue d'avancer.
 * `pool` (facultatif) sert au seul rappel isolé FR → mot : la face avant y est le sens
 * français, donc un jumeau de sens du pool est une réponse tout aussi juste (cf. frTwins).
 */
export function vocabTypeExercise(
  v: VocabItem,
  due: number,
  opts:
    | { listen: true; produce?: false; silent?: boolean; pool?: VocabItem[] }
    | { produce: true; listen?: false; silent?: never; pool?: VocabItem[] },
): TypeExercise {
  const hasMeaning = !!v.meaning && v.meaning !== "—";
  const example = effectiveExample(v);
  // La surface/lecture du dico peut porter des conventions d'affichage (parenthèses
  // optionnelles, alternatives « a; b », marqueur ～) qu'on ne peut pas taper telles
  // quelles : on accepte toutes leurs variantes développées (voir answerVariants).
  const answers = hasMeaning
    ? answerVariants(v.surface, v.reading)
    : answerVariants(v.reading);
  if (opts.produce) {
    const hit = exampleHit(v, example?.ja);
    const base = {
      mode: "type" as const,
      key: `vocab-produce:${v.id}`,
      track: "vocab" as const,
      skill: "production" as const,
      id: v.id,
      back: `${v.surface}（${v.reading}）`,
      meaning: hasMeaning ? v.meaning : undefined,
      due,
      answers,
    };
    if (example?.ja && hit) {
      return {
        ...base,
        front: example.ja.replace(hit, "◯◯"),
        prompt: example.fr ? `Complète : « ${example.fr} »` : `Complète la phrase (${v.meaning})`,
        context: example.ja,
        ...(example.fr ? { contextFr: example.fr } : {}),
        answers: answersWithHit(answers, hit),
        audioBack: { word: wordSpeechText(v.surface, v.reading) },
      };
    }
    // Rappel isolé : la question se réduit au sens FR, sans phrase pour trancher — les
    // mots qui partagent ce sens répondent donc à la question posée.
    const twins = hasMeaning ? frTwins(opts.pool ?? [], v) : [];
    return {
      ...base,
      front: hasMeaning ? v.meaning : v.surface,
      prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
      answers: [
        ...new Set([...answers, ...answerVariants(...twins.flatMap((t) => [t.surface, t.reading]))]),
      ],
      audioBack: { word: wordSpeechText(v.surface, v.reading) },
    };
  }
  if (opts.silent) {
    const ex = vocabTypeExercise(v, due, { produce: true, pool: opts.pool });
    return { ...ex, key: `vocab-listen-silent:${v.id}`, skill: "oral" };
  }
  const hit = exampleHit(v, example?.ja);
  return {
    mode: "type",
    key: `vocab-listen:${v.id}`,
    track: "vocab",
    skill: "oral",
    id: v.id,
    // Le mot cible est masqué dans la phrase affichée : c'est la réponse — le laisser
    // visible transformait l'exercice en recopie.
    front: example?.ja && hit ? example.ja.replace(hit, "◯◯") : (example?.ja ?? v.surface),
    back: `${v.surface}（${v.reading}）`,
    meaning: hasMeaning ? v.meaning : undefined,
    due,
    audio: example?.ja ? { sentence: example.ja } : { word: wordSpeechText(v.surface, v.reading) },
    context: example?.ja,
    ...(example?.fr ? { contextFr: example.fr } : {}),
    prompt: example?.ja && hit ? "Écoute et tape le mot manquant" : "Écoute et tape le mot entendu",
    answers: answersWithHit(answers, hit),
    audioBack: { word: wordSpeechText(v.surface, v.reading) },
  };
}

/** Bornes de la dictée : en dessous rien à reconstruire, au-dessus trop dur à retenir d'oreille. */
const DICTATION_MIN_TILES = 2;
const DICTATION_MAX_TILES = 8;

/**
 * Écoute → sens : la phrase d'exemple est jouée (texte masqué), l'utilisateur choisit le
 * sens FR du mot cible parmi ceux d'autres mots en rotation. Null si le mot n'a pas de
 * sens exploitable ou si le pool ne fournit pas 3 distracteurs.
 */
export function vocabListenMeaningExercise(
  v: VocabItem,
  due: number,
  pool: VocabItem[],
): ChoiceExercise | null {
  if (!v.meaning || v.meaning === "—") return null;
  const example = effectiveExample(v);
  const meanings = [
    ...new Set(
      pool
        .filter((p) => p.id !== v.id && p.meaning && p.meaning !== "—" && p.meaning !== v.meaning)
        .map((p) => p.meaning),
    ),
  ];
  const distractors = shuffle(meanings).slice(0, 3);
  if (distractors.length < 3) return null;
  const { choices, answerIndex } = shuffleWithAnswer(v.meaning, distractors);
  return {
    mode: "choice",
    key: `vocab-listen-meaning:${v.id}`,
    track: "vocab",
    skill: "oral",
    id: v.id,
    // Exercice à l'aveugle : rien à afficher en face avant, la question est la consigne.
    front: "",
    prompt: "Quel mot as-tu entendu ?",
    back: `${v.surface}（${v.reading}）`,
    meaning: v.meaning,
    due,
    audioOnly: true,
    audio: example?.ja ? { sentence: example.ja } : { word: wordSpeechText(v.surface, v.reading) },
    context: example?.ja,
    ...(example?.fr ? { contextFr: example.fr } : {}),
    choices,
    answerIndex,
    audioBack: { word: wordSpeechText(v.surface, v.reading) },
  };
}

/**
 * Dictée : la phrase d'exemple est jouée (texte masqué), l'utilisateur la reconstruit
 * par tuiles. Null sans exemple ou si la phrase est trop courte/longue pour l'oreille.
 */
export async function vocabDictationExercise(v: VocabItem, due: number): Promise<BuildExercise | null> {
  const example = effectiveExample(v);
  if (!example?.ja) return null;
  const tokens = await tokenize(example.ja);
  const target = toTiles(tokens);
  if (target.length < DICTATION_MIN_TILES || target.length > DICTATION_MAX_TILES) return null;
  return {
    mode: "build",
    key: `vocab-dictation:${v.id}`,
    track: "vocab",
    skill: "oral",
    id: v.id,
    front: "Reconstitue la phrase entendue",
    back: target.join(" "),
    due,
    audioOnly: true,
    audio: { sentence: example.ja },
    context: example.ja,
    ...(example.fr ? { contextFr: example.fr } : {}),
    target,
    tokens,
  };
}

/** Reconstruction de phrase : une tuile par phrase analysée, cible = surfaces hors ponctuation. */
export function sentenceBuildExercises(
  sentences: { fr: string; tokens: KuromojiToken[] }[],
): BuildExercise[] {
  const out: BuildExercise[] = [];
  sentences.forEach(({ fr, tokens }, i) => {
    const target = toTiles(tokens);
    if (target.length < 2) return; // phrase trop courte → rien à réordonner
    out.push({
      mode: "build",
      key: `build:${i}`,
      track: "vocab",
      id: `build:${i}`,
      front: fr,
      back: target.join(" "),
      target,
      tokens,
    });
  });
  return out;
}

function shuffleWithAnswer(correct: string, distractors: string[]): { choices: string[]; answerIndex: number } {
  const choices = shuffle([correct, ...distractors]);
  return { choices, answerIndex: choices.indexOf(correct) };
}

/** Parmi combien de points voisins (au sens du curriculum) tirer les distracteurs. */
const RULE_NEIGHBORS = 8;

/**
 * Règles d'autres points de grammaire (référentiel statique) → distracteurs sans LLM.
 * Priorité aux points introduits près du point cible dans le curriculum : des règles
 * du même thème/moment d'apprentissage sont confondables, une règle sans rapport rend
 * le QCM trivial par élimination.
 */
function ruleDistractors(excludeId: string, n = 3): string[] {
  const pool = allGrammarInv().filter((g) => g.id !== excludeId);
  const order = grammarLessonOrder();
  const target = order.get(excludeId);
  const candidates =
    target === undefined
      ? pool
      : [...pool]
          .sort((a, b) => {
            const da = order.has(a.id) ? Math.abs(order.get(a.id)! - target) : Infinity;
            const db = order.has(b.id) ? Math.abs(order.get(b.id)! - target) : Infinity;
            return da - db;
          })
          .slice(0, RULE_NEIGHBORS);
  return shuffle(candidates.map((g) => g.ruleFr)).slice(0, n);
}

/**
 * Carte de révision grammaire (ex-mode "reveal") : reconstruction de la phrase d'exemple
 * du référentiel si disponible, sinon QCM "règle parmi des règles voisines" (sans LLM).
 */
export async function grammarReviewExercise(g: GrammarItem, due: number): Promise<Exercise> {
  const detail = grammarDetail(g.id);
  const rule = g.rule || detail?.ruleFr || "";
  if (detail?.exampleJa) {
    const tokens = await tokenize(detail.exampleJa);
    const target = toTiles(tokens);
    if (target.length >= 2) {
      return {
        mode: "build",
        key: `grammar:${g.id}`,
        track: "grammar",
        id: g.id,
        front: g.name,
        back: rule,
        context: detail.exampleJa,
        ...(detail.exampleFr ? { contextFr: detail.exampleFr } : {}),
        target,
        tokens,
        due,
      };
    }
  }
  const { choices, answerIndex } = shuffleWithAnswer(rule, ruleDistractors(g.id));
  return {
    mode: "choice",
    key: `grammar:${g.id}`,
    track: "grammar",
    id: g.id,
    // Le point de grammaire est la face avant (rendu en grand) ; la question passe en
    // consigne, comme pour les cartes du triangle.
    front: g.name,
    prompt: "Que signifie ce point de grammaire ?",
    back: rule,
    choices,
    answerIndex,
    due,
    audioBack: { word: wordSpeechText(g.name) },
  };
}

export { shuffleTiles };
