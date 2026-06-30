// Application des résultats de quiz au SRS (pistes grammaire, compréhension).
import {
  getComprehensionItem,
  getGrammar,
  logReview,
  putComprehensionItem,
  putGrammar,
  type ComprehensionItem,
  type GrammarItem,
} from "./db";
import { grammarDetail } from "./inventory";
import { PARTICLE_GLOSS } from "./particles";
import { newCard, review, type SrsGrade } from "./srs";

/** Note une particule (piste grammaire). Bonne réponse ⇒ good, sinon again. */
export async function applyParticle(
  particle: string,
  correct: boolean,
  now = new Date(),
): Promise<void> {
  const grade: SrsGrade = correct ? "good" : "again";
  const id = `particle:${particle}`;
  const item: GrammarItem = (await getGrammar(id)) ?? {
    id,
    name: `particule ${particle}`,
    rule: PARTICLE_GLOSS[particle] ?? "",
    examples: [],
    tags: ["particule"],
    status: "unknown",
    card: undefined,
  };
  item.card = review(item.card ?? newCard(now), grade, now);
  item.status = "review";
  await putGrammar(item);
  await logReview({ itemId: id, track: "grammar", grade, at: now.getTime() });
}

/**
 * Note la COMPRÉHENSION d'un point de grammaire (piste dédiée, distincte de sa carte de
 * reconnaissance). Une question de QCM bien répondue ⇒ good, sinon again ; planifie via
 * FSRS sur le store `comprehension`. `name`/`rule` viennent de l'inventaire (repli sur l'id).
 */
export async function applyComprehension(
  grammarId: string,
  correct: boolean,
  now = new Date(),
): Promise<void> {
  const grade: SrsGrade = correct ? "good" : "again";
  const detail = grammarDetail(grammarId);
  const item: ComprehensionItem = (await getComprehensionItem(grammarId)) ?? {
    id: grammarId,
    name: detail?.name ?? grammarId,
    rule: detail?.ruleFr ?? "",
    status: "unknown",
    card: undefined,
  };
  item.card = review(item.card ?? newCard(now), grade, now);
  item.status = "review";
  await putComprehensionItem(item);
  await logReview({ itemId: grammarId, track: "comprehension", grade, at: now.getTime() });
}
