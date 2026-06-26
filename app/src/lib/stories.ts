// Sauvegarde / liste des histoires générées (relecture, « pourquoi cette histoire »).
import { putStory, type StoryRecord } from "./db";

export type StoryParams = StoryRecord["params"];

function makeTitle(text: string): string {
  const firstLine = text.trim().split(/\n/)[0] ?? "";
  return firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine || "Sans titre";
}

/**
 * Retire un éventuel titre Markdown (« # … ») en tête du texte généré. Le prompt
 * interdit déjà tout titre, mais le modèle en place parfois un sur la première ligne :
 * on le supprime pour que l'histoire commence directement par son texte. Si rien ne
 * reste après nettoyage (cas dégénéré), on conserve le texte original.
 */
function stripLeadingHeading(text: string): string {
  let t = text.replace(/^\s+/, "");
  while (t.startsWith("#")) {
    const nl = t.indexOf("\n");
    t = (nl === -1 ? "" : t.slice(nl + 1)).replace(/^\s+/, "");
  }
  return t.trim() || text.trim();
}

/** Enregistre une histoire (texte + contraintes de génération + leçon parente optionnelle). */
export async function saveStory(
  text: string,
  params: StoryParams = {},
  lessonId?: string,
): Promise<StoryRecord> {
  const clean = stripLeadingHeading(text);
  const story: StoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    title: makeTitle(clean),
    text: clean,
    params,
    ...(lessonId ? { lessonId } : {}),
  };
  await putStory(story);
  return story;
}
