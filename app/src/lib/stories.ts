// Sauvegarde / liste des histoires générées (relecture, « pourquoi cette histoire »).
import { getStory, putStory, type StoryRecord } from "./db";
import {
  generateComprehensionQcm,
  type ComprehensionQuestion,
  type GenState,
} from "./genClient";

export type StoryParams = StoryRecord["params"];

function makeTitle(text: string): string {
  const firstLine = text.trim().split(/\n/)[0] ?? "";
  return firstLine.length > 18 ? `${firstLine.slice(0, 18)}…` : firstLine || "Sans titre";
}

function parseTitleLine(text: string): { titleJp: string; titleFr: string; body: string } | null {
  const trimmed = text.trim();
  const firstLine = trimmed.split(/\n/)[0] ?? "";
  const m = firstLine.match(/^TITRE:\s*(.+?)\s*\|\s*(.+?)\s*$/);
  if (!m) return null;
  const body = trimmed.slice(firstLine.length).replace(/^\n+/, "");
  return { titleJp: m[1].trim(), titleFr: m[2].trim(), body };
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
  variant?: number,
): Promise<StoryRecord> {
  const stripped = stripLeadingHeading(text);
  const parsed = parseTitleLine(stripped);
  const clean = parsed ? parsed.body : stripped;
  const story: StoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    title: parsed ? parsed.titleJp : makeTitle(clean),
    text: clean,
    params,
    ...(parsed ? { titleFr: parsed.titleFr } : {}),
    ...(lessonId ? { lessonId } : {}),
    ...(variant != null ? { variant } : {}),
  };
  await putStory(story);
  return story;
}

/** Découpe un texte japonais en phrases (sur la ponctuation finale 。．！？), pour la génération. */
function splitJaSentences(text: string): string[] {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * QCM de compréhension d'une histoire, avec cache : si l'histoire en a déjà un en base,
 * on le renvoie tel quel (pas de régénération) ; sinon on génère depuis le texte + les
 * points de grammaire de la leçon, puis on persiste sur le `StoryRecord` (quand connu).
 * Pour une histoire non enregistrée (lecteur libre), on génère sans mettre en cache.
 */
export async function ensureComprehensionQuiz(
  storyId: string | undefined,
  text: string,
  level: number,
  grammar: { ids: string[]; labels: string[] },
  onState?: (s: GenState) => void,
): Promise<ComprehensionQuestion[]> {
  if (storyId) {
    const existing = await getStory(storyId);
    if (existing?.comprehension && existing.comprehension.length > 0) {
      return existing.comprehension;
    }
  }
  const questions = await generateComprehensionQcm(splitJaSentences(text), level, grammar, onState);
  if (storyId && questions.length > 0) {
    const story = await getStory(storyId);
    if (story) await putStory({ ...story, comprehension: questions });
  }
  return questions;
}
