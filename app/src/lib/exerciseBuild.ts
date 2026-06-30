// Construit des `Exercise` (lib/exercise.ts) à partir des sources du Lecteur :
// particules (déterministe), QCM de compréhension (LLM, déjà généré), reconstruction de
// phrase (tokenisation + traduction). Pas de logique de notation ici (voir gradeExercise).

import { toTiles, shuffleTiles } from "./builder";
import type { ComprehensionItem, GrammarItem } from "./db";
import type { ChoiceExercise, BuildExercise, Exercise } from "./exercise";
import type { ComprehensionQuestion } from "./genClient";
import { allGrammarInv, grammarDetail } from "./inventory";
import { PARTICLE_GLOSS } from "./particles";
import { tokenize, type KuromojiToken } from "./tokenizer";

const PARTICLE_POOL = ["は", "が", "を", "に", "で", "へ", "と", "も", "から", "まで"];
const CORE_PARTICLES = new Set(["は", "が", "を", "に", "で", "へ", "と"]);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function particleChoices(answer: string): string[] {
  const distractors = shuffle(PARTICLE_POOL.filter((p) => p !== answer)).slice(0, 3);
  return shuffle([answer, ...distractors]);
}

/** Quiz particule (rappel actif) : construit jusqu'à `max` questions à partir des tokens. */
export function particleExercises(tokens: KuromojiToken[], max = 8): ChoiceExercise[] {
  const surfaces = tokens.map((t) => t.surface_form);
  const out: ChoiceExercise[] = [];

  tokens.forEach((t, i) => {
    if (t.pos === "助詞" && CORE_PARTICLES.has(t.surface_form)) {
      const choices = particleChoices(t.surface_form);
      out.push({
        mode: "choice",
        key: `particle:${i}`,
        track: "grammar",
        id: `particle:${t.surface_form}`,
        front: t.surface_form,
        back: t.surface_form,
        seedName: `particule ${t.surface_form}`,
        seedRule: PARTICLE_GLOSS[t.surface_form] ?? "",
        cloze: { before: surfaces.slice(0, i).join(""), after: surfaces.slice(i + 1).join("") },
        choices,
        answerIndex: choices.indexOf(t.surface_form),
      });
    }
  });

  return shuffle(out).slice(0, max);
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

/** Règles d'autres points de grammaire (référentiel statique) → distracteurs sans LLM. */
function ruleDistractors(excludeId: string, n = 3): string[] {
  return shuffle(
    allGrammarInv()
      .filter((g) => g.id !== excludeId)
      .map((g) => g.ruleFr),
  ).slice(0, n);
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
