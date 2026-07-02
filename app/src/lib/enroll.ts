// Enrôlement SRS : crée les items vocab/kanji/grammaire dans la base SANS carte FSRS.
// Un item enrôlé est "vu" mais pas encore en rotation de révision.
// Idempotent : n'écrase jamais une carte existante.

import { grammarDetail, resolveVocab } from "./inventory";
import {
  getVocab, putVocab, getGrammar, putGrammar,
  type VocabItem, type GrammarItem,
} from "./db";
import { getCurriculumEntry } from "./curriculum";
import { isContent, itemIdFor, meaningFor } from "./vocab";
import { tokenize } from "./tokenizer";
import { kataToHira } from "./kana";
import type { StoryRecord } from "./db";

export async function enrollLesson(lessonId: string): Promise<void> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return;
  const { introduces } = entry;

  await Promise.all([
    ...introduces.vocab.map(async (id) => {
      const existing = await getVocab(id);
      if (existing) return;
      const v = resolveVocab(id);
      const [, reading] = id.split("|");
      const item: VocabItem = {
        id,
        surface: v.ja,
        reading: reading ?? v.ja,
        meaning: v.fr,
        tags: [],
        status: "unknown",
        cards: {},
      };
      await putVocab(item);
    }),
    ...introduces.grammar.map(async (id) => {
      const existing = await getGrammar(id);
      if (existing) return;
      const g = grammarDetail(id);
      if (!g) return;
      const item: GrammarItem = {
        id,
        name: g.name,
        rule: g.ruleFr,
        examples: [g.exampleJa],
        tags: [],
        status: "unknown",
      };
      await putGrammar(item);
    }),
  ]);
}

export async function enrollStory(story: StoryRecord): Promise<void> {
  const tokens = await tokenize(story.text);
  // Découpe en phrases sur 。！？
  const sentences = story.text.split(/(?<=[。！？])/);

  await Promise.all(
    tokens
      .filter(isContent)
      .map(async (token) => {
        const id = itemIdFor(token);
        const existing = await getVocab(id);
        if (existing) return;

        const surface = token.surface_form;
        const sentence = sentences.find((s) => s.includes(surface)) ?? "";

        const item: VocabItem = {
          id,
          surface: token.surface_form,
          reading: token.reading ? kataToHira(token.reading) : token.surface_form,
          meaning: meaningFor(token),
          tags: [],
          status: "unknown",
          cards: {},
          example: sentence ? { ja: sentence } : undefined,
        };
        await putVocab(item);
      }),
  );

  if (story.params.grammar) {
    await Promise.all(
      story.params.grammar.map(async (id) => {
        const existing = await getGrammar(id);
        if (existing) return;
        const g = grammarDetail(id);
        if (!g) return;
        const item: GrammarItem = {
          id,
          name: g.name,
          rule: g.ruleFr,
          examples: [g.exampleJa],
          tags: [],
          status: "unknown",
        };
        await putGrammar(item);
      }),
    );
  }
}
