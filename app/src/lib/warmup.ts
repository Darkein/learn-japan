// Échauffement de révision (SPEC §5) : les éléments SRS dus, toutes pistes confondues,
// triés par urgence — recall rapide avant la lecture.

import {
  allComprehension,
  allGrammar,
  allKanji,
  allVocab,
  bumpSrsDaily,
  getComprehensionItem,
  getDB,
  getGrammar,
  getKanji,
  getSrsDaily,
  getVocab,
  putComprehensionItem,
  putGrammar,
  putKanji,
  putVocab,
} from "./db";
import { normalizeReading } from "./kana";
import { getCurriculumEntry } from "./lessons";
import { isDue, newCard, review, type SrsGrade } from "./srs";
import { SRS } from "./config";

export interface WarmupCard {
  key: string;
  track: "vocab" | "kanji" | "grammar" | "comprehension";
  id: string;
  front: string;
  back: string;
  due: number;
  /** "type" = rappel actif ; "reveal" = révélation + auto-note ; "listen" = écoute. */
  mode: "type" | "reveal" | "listen";
  /** Réponses NORMALISÉES acceptées (mode "type"). */
  answers?: string[];
  /** Consigne courte affichée au-dessus du champ (mode "type"). */
  prompt?: string;
  /** Phrase d'origine (pour carte contextuelle — Task 5). */
  context?: string;
  /** Élément difficile (≥ SRS.leechLapses échecs). */
  isLeech?: boolean;
}

export interface SessionOpts {
  /** "due" = révision SRS globale plafonnée (défaut). "all" = entraînement immédiat toute la leçon. */
  scope?: "due" | "all";
  /** Si fourni et scope="all", filtre sur les ids introduces de cette leçon. */
  lessonId?: string;
}

function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Lectures acceptées d'un kanji isolé : on (katakana → hiragana) + kun, dont on retient à la
 * fois le radical avant l'okurigana (« た » dans « た.べる ») et la forme entière sans le point
 * (« たべる ») — tolérant pour éviter les faux négatifs au rappel actif.
 */
function kanjiReadingAnswers(kun: string[], on: string[]): string[] {
  const set = new Set<string>();
  for (const r of on) set.add(normalizeReading(r));
  for (const r of kun) {
    const stem = r.includes(".") ? r.slice(0, r.indexOf(".")) : r;
    set.add(normalizeReading(stem));
    set.add(normalizeReading(r.replace(/\./g, "")));
  }
  set.delete("");
  return [...set];
}

export async function leechIds(): Promise<Set<string>> {
  const db = await getDB();
  const reviews = await db.getAll("reviews");
  const lapses = new Map<string, number>();
  for (const r of reviews) {
    if (r.grade === "again") lapses.set(r.itemId, (lapses.get(r.itemId) ?? 0) + 1);
  }
  const ids = new Set<string>();
  for (const [id, count] of lapses) {
    if (count >= SRS.leechLapses) ids.add(id);
  }
  return ids;
}

export async function buildSession(
  now: Date = new Date(),
  opts: SessionOpts = {},
): Promise<WarmupCard[]> {
  const scope = opts.scope ?? "due";

  let cards: WarmupCard[];
  if (scope === "all") {
    if (!opts.lessonId) return [];
    cards = await buildSessionAll(opts.lessonId, now);
  } else {
    cards = await buildSessionDue(now);
  }

  const leeches = await leechIds();
  for (const card of cards) {
    if (leeches.has(card.id)) card.isLeech = true;
  }
  return cards;
}

async function buildSessionDue(now: Date): Promise<WarmupCard[]> {
  const out: WarmupCard[] = [];

  // Collecte items dus (avec carte FSRS)
  for (const v of await allVocab()) {
    const c = v.cards.written;
    if (c && isDue(c, now)) {
      const hasMeaning = !!v.meaning && v.meaning !== "—";
      out.push({
        key: `vocab:${v.id}`,
        track: "vocab",
        id: v.id,
        front: hasMeaning ? v.meaning : v.surface,
        back: `${v.surface}（${v.reading}）`,
        due: c.due.getTime(),
        mode: "type",
        prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
        answers: hasMeaning
          ? [normalizeReading(v.surface), normalizeReading(v.reading)]
          : [normalizeReading(v.reading)],
        ...(v.example?.ja ? { context: v.example.ja } : {}),
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
        mode: "type",
        prompt: "Tape une lecture",
        answers: kanjiReadingAnswers(k.kun, k.on),
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
        mode: "reveal",
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
        mode: "reveal",
      });
    }
  }

  // Listen cards (max 5) — vocab dus avec phrase d'exemple
  let listenCount = 0;
  for (const v of await allVocab()) {
    if (listenCount >= 5) break;
    const c = v.cards.written;
    if (c && isDue(c, now) && v.example?.ja) {
      const hasMeaning = !!v.meaning && v.meaning !== "—";
      out.push({
        key: `vocab-listen:${v.id}`,
        track: "vocab",
        id: v.id,
        front: v.example.ja,
        back: `${v.surface}（${v.reading}）— ${v.meaning}`,
        due: c.due.getTime(),
        mode: "listen",
        context: v.example.ja,
        prompt: "Écoute et tape le mot souligné",
        answers: hasMeaning
          ? [normalizeReading(v.surface), normalizeReading(v.reading)]
          : [normalizeReading(v.reading)],
      });
      listenCount++;
    }
  }

  // Budget nouveaux items
  const dateStr = localDateString(now);
  const daily = await getSrsDaily(dateStr);
  const budget = Math.max(0, SRS.newPerDay - (daily?.introduced ?? 0));

  if (out.length < SRS.dailyGoal && budget > 0) {
    const newCards: WarmupCard[] = [];
    const toPromote = Math.max(0, Math.min(budget, SRS.dailyGoal - out.length));

    // Vocab sans carte
    for (const v of await allVocab()) {
      if (newCards.length >= toPromote) break;
      if (!v.cards.written) {
        const card = newCard(now);
        v.cards.written = card;
        await putVocab(v);
        await bumpSrsDaily(dateStr, { introduced: 1 });
        const hasMeaning = !!v.meaning && v.meaning !== "—";
        newCards.push({
          key: `vocab:${v.id}`,
          track: "vocab",
          id: v.id,
          front: hasMeaning ? v.meaning : v.surface,
          back: `${v.surface}（${v.reading}）`,
          due: card.due.getTime(),
          mode: "type",
          prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
          answers: hasMeaning
            ? [normalizeReading(v.surface), normalizeReading(v.reading)]
            : [normalizeReading(v.reading)],
          ...(v.example?.ja ? { context: v.example.ja } : {}),
        });
      }
    }

    // Kanji sans carte
    if (newCards.length < toPromote) {
      for (const k of await allKanji()) {
        if (newCards.length >= toPromote) break;
        if (!k.card) {
          const card = newCard(now);
          k.card = card;
          await putKanji(k);
          await bumpSrsDaily(dateStr, { introduced: 1 });
          const readings = [...k.kun, ...k.on].join(" / ");
          newCards.push({
            key: `kanji:${k.id}`,
            track: "kanji",
            id: k.id,
            front: k.kanji,
            back: [readings, k.meanings.join(", ")].filter(Boolean).join(" — "),
            due: card.due.getTime(),
            mode: "type",
            prompt: "Tape une lecture",
            answers: kanjiReadingAnswers(k.kun, k.on),
          });
        }
      }
    }

    // Grammar sans carte
    if (newCards.length < toPromote) {
      for (const g of await allGrammar()) {
        if (newCards.length >= toPromote) break;
        if (!g.card) {
          const card = newCard(now);
          g.card = card;
          await putGrammar(g);
          await bumpSrsDaily(dateStr, { introduced: 1 });
          newCards.push({
            key: `grammar:${g.id}`,
            track: "grammar",
            id: g.id,
            front: g.name,
            back: g.rule || "—",
            due: card.due.getTime(),
            mode: "reveal",
          });
        }
      }
    }

    out.push(...newCards);
  }

  return out.sort((a, b) => a.due - b.due);
}

async function buildSessionAll(lessonId: string, now: Date): Promise<WarmupCard[]> {
  const entry = getCurriculumEntry(lessonId);
  if (!entry) return [];

  const out: WarmupCard[] = [];
  const { vocab: vocabIds, kanji: kanjiIds, grammar: grammarIds } = entry.introduces;

  // Vocab
  for (const id of vocabIds) {
    const v = await getVocab(id);
    if (!v) continue;
    if (!v.cards.written) {
      v.cards.written = newCard(now);
      await putVocab(v);
    }
    const c = v.cards.written!;
    const hasMeaning = !!v.meaning && v.meaning !== "—";
    out.push({
      key: `vocab:${v.id}`,
      track: "vocab",
      id: v.id,
      front: hasMeaning ? v.meaning : v.surface,
      back: `${v.surface}（${v.reading}）`,
      due: c.due.getTime(),
      mode: "type",
      prompt: hasMeaning ? "Tape le mot en japonais" : "Tape la lecture",
      answers: hasMeaning
        ? [normalizeReading(v.surface), normalizeReading(v.reading)]
        : [normalizeReading(v.reading)],
      ...(v.example?.ja ? { context: v.example.ja } : {}),
    });
  }

  // Kanji
  for (const id of kanjiIds) {
    const k = await getKanji(id);
    if (!k) continue;
    if (!k.card) {
      k.card = newCard(now);
      await putKanji(k);
    }
    const c = k.card!;
    const readings = [...k.kun, ...k.on].join(" / ");
    out.push({
      key: `kanji:${k.id}`,
      track: "kanji",
      id: k.id,
      front: k.kanji,
      back: [readings, k.meanings.join(", ")].filter(Boolean).join(" — "),
      due: c.due.getTime(),
      mode: "type",
      prompt: "Tape une lecture",
      answers: kanjiReadingAnswers(k.kun, k.on),
    });
  }

  // Grammar
  for (const id of grammarIds) {
    const g = await getGrammar(id);
    if (!g) continue;
    if (!g.card) {
      g.card = newCard(now);
      await putGrammar(g);
    }
    const c = g.card!;
    out.push({
      key: `grammar:${g.id}`,
      track: "grammar",
      id: g.id,
      front: g.name,
      back: g.rule || "—",
      due: c.due.getTime(),
      mode: "reveal",
    });
  }

  // Urgents d'abord, nouveaux à la fin
  return out.sort((a, b) => a.due - b.due);
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
  await bumpSrsDaily(localDateString(now), { reviewed: 1 });
}

/** @deprecated Use buildSession instead. */
export const dueCards = (now?: Date) => buildSession(now, { scope: "due" });
