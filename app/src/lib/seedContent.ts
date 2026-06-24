// Contenu « seed » des premières leçons, sorti du gros curriculum.json :
//  - le CADRAGE du cours = un fichier Markdown par leçon (app/src/content/lessons/<id>.md) ;
//  - les HISTOIRES seed = app/src/data/seed-stories.json, matérialisées en StoryRecord
//    (store `stories`) avec un id déterministe `seed:<lessonId>:<n>` → idempotent, visibles
//    dans l'onglet Histoires, ouvrables, et prêtes pour l'audio/podcast (SPEC §11–12).

import { getStory, putStory, type StoryRecord } from "./db";
import seedStoriesData from "../data/seed-stories.json";

// Cadrage Markdown chargé à la compilation (Vite) : { "../content/lessons/n5-01-….md": "texte" }.
const framingFiles = import.meta.glob("../content/lessons/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const framingById = new Map<string, string>();
for (const [path, raw] of Object.entries(framingFiles)) {
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  framingById.set(id, raw.trim());
}

/** Cadrage rédigé (Markdown) du cours d'une leçon, ou undefined si non seedé. */
export function seedFraming(lessonId: string): string | undefined {
  return framingById.get(lessonId);
}

const seedStories = (seedStoriesData as { stories: Record<string, string[]> }).stories;

// Base d'horodatage stable pour préserver l'ordre des histoires seed devant les générées.
const SEED_EPOCH = 0;

function seedStoryId(lessonId: string, index: number): string {
  return `seed:${lessonId}:${index}`;
}

function makeTitle(text: string): string {
  const first = text.trim().split(/\n/)[0] ?? "";
  return first.length > 18 ? `${first.slice(0, 18)}…` : first || "Sans titre";
}

/**
 * Matérialise (une fois) les histoires seed en StoryRecord si elles n'existent pas déjà.
 * Idempotent grâce à l'id déterministe. À appeler au démarrage de l'app.
 */
export async function ensureSeedStories(): Promise<void> {
  for (const [lessonId, texts] of Object.entries(seedStories)) {
    for (let i = 0; i < texts.length; i++) {
      const id = seedStoryId(lessonId, i);
      if (await getStory(id)) continue;
      const story: StoryRecord = {
        id,
        createdAt: SEED_EPOCH + i,
        title: makeTitle(texts[i]),
        text: texts[i].trim(),
        params: { level: 5 },
        lessonId,
      };
      await putStory(story);
    }
  }
}
