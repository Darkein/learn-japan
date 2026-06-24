// Sauvegarde / liste des histoires générées (relecture, « pourquoi cette histoire »).
import { putStory, type StoryRecord } from "./db";

export type StoryParams = StoryRecord["params"];

function makeTitle(text: string): string {
  const firstLine = text.trim().split(/\n/)[0] ?? "";
  return firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine || "Sans titre";
}

/** Enregistre une histoire (texte + contraintes de génération + leçon parente optionnelle). */
export async function saveStory(
  text: string,
  params: StoryParams = {},
  lessonId?: string,
): Promise<StoryRecord> {
  const story: StoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    title: makeTitle(text),
    text: text.trim(),
    params,
    ...(lessonId ? { lessonId } : {}),
  };
  await putStory(story);
  return story;
}
