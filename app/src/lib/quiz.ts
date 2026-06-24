// Génération DÉTERMINISTE de questions de quiz à partir des tokens d'une phrase :
// - lecture de kanji (« comment se lit 食べる ? »)
// - particule à compléter (« 猫◯水を… : は / が / を / に ? »)
// La compréhension (QCM sur le sens) viendra du LLM via le Worker plus tard.

import { hasKanji, isKanji, kataToHira } from "./kana";
import type { KuromojiToken } from "./tokenizer";

export interface KanjiReadingQ {
  kind: "kanji-reading";
  id: string;
  surface: string;
  reading: string;
  kanji: string[];
}

export interface ParticleQ {
  kind: "particle";
  id: string;
  before: string;
  after: string;
  answer: string;
  choices: string[];
}

export type QuizQuestion = KanjiReadingQ | ParticleQ;

const PARTICLE_POOL = ["は", "が", "を", "に", "で", "へ", "と", "も", "から", "まで"];
const CORE_PARTICLES = new Set(["は", "が", "を", "に", "で", "へ", "と"]);

function uniqueKanji(s: string): string[] {
  return [...new Set([...s].filter(isKanji))];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function choicesFor(answer: string): string[] {
  const distractors = shuffle(PARTICLE_POOL.filter((p) => p !== answer)).slice(0, 3);
  return shuffle([answer, ...distractors]);
}

/** Construit jusqu'à `max` questions à partir des tokens (lecture kanji + particules). */
export function buildQuiz(tokens: KuromojiToken[], max = 8): QuizQuestion[] {
  const surfaces = tokens.map((t) => t.surface_form);
  const questions: QuizQuestion[] = [];

  tokens.forEach((t, i) => {
    if (hasKanji(t.surface_form) && t.reading) {
      questions.push({
        kind: "kanji-reading",
        id: `k${i}`,
        surface: t.surface_form,
        reading: kataToHira(t.reading),
        kanji: uniqueKanji(t.surface_form),
      });
    } else if (t.pos === "助詞" && CORE_PARTICLES.has(t.surface_form)) {
      questions.push({
        kind: "particle",
        id: `p${i}`,
        before: surfaces.slice(0, i).join(""),
        after: surfaces.slice(i + 1).join(""),
        answer: t.surface_form,
        choices: choicesFor(t.surface_form),
      });
    }
  });

  return shuffle(questions).slice(0, max);
}
