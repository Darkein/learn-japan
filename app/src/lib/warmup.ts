// Échauffement de révision (SPEC §5) : les éléments SRS dus, toutes pistes confondues,
// triés par urgence — recall rapide avant la lecture.

import {
  allComprehension,
  allGrammar,
  allKanji,
  allVocab,
  getComprehensionItem,
  getGrammar,
  getKanji,
  getVocab,
  putComprehensionItem,
  putGrammar,
  putKanji,
  putVocab,
} from "./db";
import { isDue, review, type SrsGrade } from "./srs";

export interface WarmupCard {
  key: string;
  track: "vocab" | "kanji" | "grammar" | "comprehension";
  id: string;
  front: string; // indice montré
  back: string; // réponse révélée
  due: number;
}

/** Cartes dues (toutes pistes), les plus urgentes d'abord, limitées à `max`. */
export async function dueCards(now: Date = new Date(), max = 15): Promise<WarmupCard[]> {
  const out: WarmupCard[] = [];

  for (const v of await allVocab()) {
    const c = v.cards.written;
    if (c && isDue(c, now)) {
      out.push({
        key: `vocab:${v.id}`,
        track: "vocab",
        id: v.id,
        front: v.meaning && v.meaning !== "—" ? v.meaning : v.surface,
        back: `${v.surface}（${v.reading}）`,
        due: c.due.getTime(),
      });
    }
  }
  for (const k of await allKanji()) {
    if (k.card && isDue(k.card, now)) {
      const readings = [...k.kun, ...k.on].join(" / ");
      out.push({
        key: `kanji:${k.id}`,
        track: "kanji",
        id: k.id,
        front: k.kanji,
        back: [readings, k.meanings.join(", ")].filter(Boolean).join(" — "),
        due: k.card.due.getTime(),
      });
    }
  }
  for (const g of await allGrammar()) {
    if (g.card && isDue(g.card, now)) {
      out.push({
        key: `grammar:${g.id}`,
        track: "grammar",
        id: g.id,
        front: g.name,
        back: g.rule || "—",
        due: g.card.due.getTime(),
      });
    }
  }
  for (const c of await allComprehension()) {
    if (c.card && isDue(c.card, now)) {
      out.push({
        key: `comprehension:${c.id}`,
        track: "comprehension",
        id: c.id,
        front: `Compréhension — ${c.name}`,
        back: c.rule || "—",
        due: c.card.due.getTime(),
      });
    }
  }

  return out.sort((a, b) => a.due - b.due).slice(0, max);
}

/** Note une carte d'échauffement et replanifie via FSRS. */
export async function gradeCard(card: WarmupCard, grade: SrsGrade, now: Date = new Date()): Promise<void> {
  if (card.track === "vocab") {
    const v = await getVocab(card.id);
    if (!v?.cards.written) return;
    v.cards.written = review(v.cards.written, grade, now);
    await putVocab(v);
  } else if (card.track === "kanji") {
    const k = await getKanji(card.id);
    if (!k?.card) return;
    k.card = review(k.card, grade, now);
    await putKanji(k);
  } else if (card.track === "comprehension") {
    const c = await getComprehensionItem(card.id);
    if (!c?.card) return;
    c.card = review(c.card, grade, now);
    await putComprehensionItem(c);
  } else {
    const g = await getGrammar(card.id);
    if (!g?.card) return;
    g.card = review(g.card, grade, now);
    await putGrammar(g);
  }
}
