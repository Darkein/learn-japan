// Application des résultats de quiz au SRS (pistes kanji et grammaire).
import { lookupKanji } from "./data";
import {
  getGrammar,
  getKanji,
  logReview,
  putGrammar,
  putKanji,
  type GrammarItem,
  type KanjiItem,
} from "./db";
import { PARTICLE_GLOSS } from "./particles";
import { newCard, review, type SrsGrade } from "./srs";

/** Note un kanji isolé (piste kanji). `easy` ⇒ connu, sinon à réviser. */
export async function applyKanji(char: string, grade: SrsGrade, now = new Date()): Promise<void> {
  const info = lookupKanji(char);
  const item: KanjiItem = (await getKanji(char)) ?? {
    id: char,
    kanji: char,
    meanings: info?.meanings ?? [],
    on: info?.on ?? [],
    kun: info?.kun ?? [],
    tags: [],
    jlpt: info?.jlpt ?? undefined,
    status: "unknown",
    card: undefined,
  };
  item.card = review(item.card ?? newCard(now), grade, now);
  item.status = grade === "easy" ? "known" : "review";
  await putKanji(item);
  await logReview({ itemId: char, track: "kanji", grade, at: now.getTime() });
}

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
