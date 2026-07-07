// Construit des `Exercise` (lib/exercise.ts) à partir des sources du Lecteur :
// particules (déterministe), QCM de compréhension (LLM, déjà généré), reconstruction de
// phrase (tokenisation + traduction). Pas de logique de notation ici (voir gradeExercise).

import { toTiles, shuffleTiles } from "./builder";
import type { ComprehensionItem, GrammarItem, VocabItem } from "./db";
import { clozeSentence, clozeSentenceParts, type ChoiceExercise, type BuildExercise, type Exercise, type TypeExercise } from "./exercise";
import type { ComprehensionQuestion } from "./genClient";
import { grammarLessonOrder } from "./curriculum";
import { allGrammarInv, grammarDetail } from "./inventory";
import { hasKanji, normalizeReading } from "./kana";
import { particleDistractors } from "./particleDistractors";
import { PARTICLE_GLOSS } from "./particles";
import { shuffle } from "./random";
import { tokenize, type KuromojiToken } from "./tokenizer";
import { effectiveExample, isContent, itemIdFor, meaningFor } from "./vocab";

const CORE_PARTICLES = new Set(["は", "が", "を", "に", "で", "へ", "と"]);

function particleChoices(answer: string): string[] {
  return shuffle([answer, ...particleDistractors(answer)]);
}

/**
 * Quiz particule (rappel actif) : construit jusqu'à `max` questions à partir des tokens.
 * `translation` (phrases JA alignées avec leur FR, cf. `splitJaSentences`) : attache la
 * traduction FR de la phrase contenant le trou, affichée dans la correction.
 */
export function particleExercises(
  tokens: KuromojiToken[],
  max = 8,
  translation?: { ja: string[]; fr: string[] },
): ChoiceExercise[] {
  const surfaces = tokens.map((t) => t.surface_form);
  const out: ChoiceExercise[] = [];

  tokens.forEach((t, i) => {
    if (t.pos === "助詞" && CORE_PARTICLES.has(t.surface_form)) {
      const choices = particleChoices(t.surface_form);
      // On ne montre que la PHRASE contenant le trou, pas tout l'article : on borne
      // `before`/`after` à ses limites de phrase.
      const cloze = clozeSentenceParts({
        before: surfaces.slice(0, i).join(""),
        after: surfaces.slice(i + 1).join(""),
      });
      const idx = translation ? translation.ja.indexOf(clozeSentence(cloze, t.surface_form)) : -1;
      out.push({
        mode: "choice",
        key: `particle:${i}`,
        track: "grammar",
        id: `particle:${t.surface_form}`,
        front: t.surface_form,
        back: t.surface_form,
        seedName: `particule ${t.surface_form}`,
        seedRule: PARTICLE_GLOSS[t.surface_form] ?? "",
        cloze,
        choices,
        answerIndex: choices.indexOf(t.surface_form),
        ...(idx >= 0 && translation?.fr[idx] ? { contextFr: translation.fr[idx] } : {}),
      });
    }
  });

  return shuffle(out).slice(0, max);
}

/** Forme de base (dictionnaire) d'un token, ou sa surface si kuromoji ne la donne pas. */
function baseForm(t: KuromojiToken): string {
  return t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form;
}

/**
 * Lecture en kana de la FORME DE BASE d'un token. Si le mot apparaît déjà sous sa forme
 * de base, la lecture du token convient ; sinon (verbe/adjectif conjugué) on retokenise
 * la forme de base pour obtenir sa vraie lecture — fiable même pour les irréguliers
 * (来る→くる vs 来ます→きます), là où une reconstruction depuis la surface se tromperait.
 */
async function baseReading(t: KuromojiToken): Promise<string> {
  const base = baseForm(t);
  if (t.surface_form === base && t.reading) return normalizeReading(t.reading);
  const sub = await tokenize(base);
  return normalizeReading(sub.map((s) => s.reading ?? s.surface_form).join(""));
}

/**
 * Lecture d'un kanji (rappel actif) : le mot est affiché sous sa FORME DE BASE en kanji,
 * l'apprenant tape sa lecture en kana (furigana). Construit depuis les mots de contenu de
 * l'histoire dont la forme de base porte au moins un kanji ; dédupliqué par item, borné à
 * `max`. Noté sur la compétence « écrite » (via `applyStatus`).
 */
export async function kanjiReadingExercises(tokens: KuromojiToken[], max = 4): Promise<TypeExercise[]> {
  const seen = new Set<string>();
  const out: TypeExercise[] = [];
  for (const t of tokens) {
    const base = baseForm(t);
    if (!isContent(t) || !hasKanji(base)) continue;
    const id = itemIdFor(t);
    if (seen.has(id)) continue;
    seen.add(id);
    const reading = await baseReading(t);
    if (!reading) continue;
    const meaning = meaningFor(t);
    out.push({
      mode: "type",
      key: `kanji-reading:${id}`,
      track: "vocab",
      skill: "written",
      id,
      token: t,
      front: base,
      back: `${base}（${reading}）`,
      meaning: meaning && meaning !== "—" ? meaning : undefined,
      prompt: "Écris la lecture en kana (furigana)",
      answers: [reading],
      audioBack: { word: base },
    });
  }
  return shuffle(out).slice(0, max);
}

/**
 * Choix du bon kanji pour un mot donné en français : la face avant montre le sens FR,
 * l'apprenant choisit la graphie correcte parmi des mots-kanji de l'histoire. Ne se
 * construit que s'il y a assez de noms-kanji distincts (≥ 4) pour fournir 3 distracteurs
 * plausibles et de même niveau. Noté sur la compétence « écrite ».
 */
export function kanjiChoiceExercises(tokens: KuromojiToken[], max = 3): ChoiceExercise[] {
  const pool: { token: KuromojiToken; surface: string; meaning: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const base = baseForm(t);
    if (t.pos !== "名詞" || t.pos_detail_1 === "非自立" || !hasKanji(base)) continue;
    const meaning = meaningFor(t);
    if (!meaning || meaning === "—") continue;
    const id = itemIdFor(t);
    if (seen.has(id)) continue;
    seen.add(id);
    pool.push({ token: t, surface: base, meaning, id });
  }
  if (pool.length < 4) return []; // pas assez de distracteurs plausibles
  const out: ChoiceExercise[] = [];
  pool.forEach((item, i) => {
    const distractors = shuffle(
      pool.filter((p) => p.surface !== item.surface).map((p) => p.surface),
    ).slice(0, 3);
    if (distractors.length < 3) return;
    const { choices, answerIndex } = shuffleWithAnswer(item.surface, distractors);
    out.push({
      mode: "choice",
      key: `kanji-choice:${i}`,
      track: "vocab",
      skill: "written",
      id: item.id,
      token: item.token,
      front: `Quel mot s'écrit « ${item.meaning} » ?`,
      back: `${item.surface}（${normalizeReading(item.token.reading ?? "")}）`,
      meaning: item.meaning,
      choices,
      answerIndex,
      audioBack: { word: item.surface },
    });
  });
  return shuffle(out).slice(0, max);
}

/**
 * Carte vocabulaire en saisie active (mot FR → japonais, ou lecture si pas de sens connu).
 * `listen` : variante écoute — la phrase d'exemple est jouée, l'utilisateur tape le mot
 * entendu (exige un exemple). Le mot cible est masqué (◯◯) dans la phrase affichée quand
 * il s'y trouve tel quel.
 * `listen` + `silent` : remplacement écrit de l'écoute (réglage « sans le son ») — cloze
 * de production sur la phrase d'exemple, mais noté sur la carte ORALE pour que sa
 * planification continue d'avancer.
 * `produce` : variante production en contexte (carte `production`) — cloze ◯◯ sur la
 * phrase d'exemple avec la traduction FR en indice ; sans exemple exploitable, retombe
 * sur le rappel isolé FR → mot, toujours noté sur la compétence production.
 */
export function vocabTypeExercise(
  v: VocabItem,
  due: number,
  opts: { listen?: boolean; produce?: boolean; silent?: boolean } = {},
): TypeExercise {
  const hasMeaning = !!v.meaning && v.meaning !== "—";
  const example = effectiveExample(v);
  const answers = hasMeaning
    ? [normalizeReading(v.surface), normalizeReading(v.reading)]
    : [normalizeReading(v.reading)];
  if (opts.produce) {
    const hit = example?.ja.includes(v.surface)
      ? v.surface
      : example?.ja.includes(v.reading)
        ? v.reading
        : null;
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
      };
    }
    return {
      ...base,
      front: hasMeaning ? v.meaning : v.surface,
      prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
      audioBack: { word: v.surface },
    };
  }
  if (opts.listen) {
    if (opts.silent) {
      const ex = vocabTypeExercise(v, due, { produce: true });
      return { ...ex, key: `vocab-listen-silent:${v.id}`, skill: "oral" };
    }
    const hit = example?.ja.includes(v.surface)
      ? v.surface
      : example?.ja.includes(v.reading)
        ? v.reading
        : null;
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
      audio: example?.ja ? { sentence: example.ja } : { word: v.surface },
      context: example?.ja,
      ...(example?.fr ? { contextFr: example.fr } : {}),
      prompt: example?.ja && hit ? "Écoute et tape le mot manquant" : "Écoute et tape le mot entendu",
      answers,
    };
  }
  return {
    mode: "type",
    key: `vocab:${v.id}`,
    track: "vocab",
    id: v.id,
    front: hasMeaning ? v.meaning : v.surface,
    back: `${v.surface}（${v.reading}）`,
    meaning: hasMeaning ? v.meaning : undefined,
    due,
    prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
    answers,
    ...(example?.ja ? { context: example.ja } : { audioBack: { word: v.surface } }),
    ...(example?.fr ? { contextFr: example.fr } : {}),
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
    front: "Quel mot as-tu entendu ?",
    back: `${v.surface}（${v.reading}）`,
    meaning: v.meaning,
    due,
    audioOnly: true,
    audio: example?.ja ? { sentence: example.ja } : { word: v.surface },
    context: example?.ja,
    ...(example?.fr ? { contextFr: example.fr } : {}),
    choices,
    answerIndex,
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

/** QCM de compréhension (LLM) déjà généré → exercices `choice` (piste compréhension). */
export function comprehensionExercises(questions: ComprehensionQuestion[]): ChoiceExercise[] {
  return questions.map((q, i) => {
    const detail = q.targetGrammarId ? grammarDetail(q.targetGrammarId) : null;
    return {
      mode: "choice",
      key: `comprehension:${i}`,
      track: "comprehension",
      id: q.targetGrammarId ?? `comprehension:${i}`,
      front: q.question,
      back: q.options[q.answerIndex],
      seedName: detail?.name ?? q.targetGrammarId,
      seedRule: detail?.ruleFr,
      choices: q.options,
      answerIndex: q.answerIndex,
    };
  });
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
    front: `Que signifie « ${g.name} » ?`,
    back: rule,
    choices,
    answerIndex,
    due,
    audioBack: { word: g.name },
  };
}

/** Carte de révision compréhension (ex-mode "reveal") : QCM "règle parmi des règles voisines". */
export function comprehensionReviewExercise(c: ComprehensionItem, due: number): ChoiceExercise {
  const { choices, answerIndex } = shuffleWithAnswer(c.rule, ruleDistractors(c.id));
  return {
    mode: "choice",
    key: `comprehension:${c.id}`,
    track: "comprehension",
    id: c.id,
    front: `Compréhension — ${c.name}`,
    back: c.rule,
    choices,
    answerIndex,
    due,
  };
}

export { shuffleTiles };
