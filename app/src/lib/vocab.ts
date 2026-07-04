// Lien Lecteur ↔ SRS : crée/maj un item de vocabulaire à partir d'un token et applique
// un changement de statut (connu / à revoir / oublié) en planifiant via FSRS.

import { contentDictSnapshot } from "./data";
import { kataToHira } from "./kana";
import {
  getVocab,
  logReview,
  putVocab,
  type ItemStatus,
  type VocabItem,
} from "./db";
import { staticExample } from "./inventory";
import { newCard, review, type SrsGrade } from "./srs";
import type { KuromojiToken } from "./tokenizer";

const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞"]);

/** Un token porte-t-il du sens lexical (candidat au SRS vocabulaire) ? */
export function isContent(token: KuromojiToken): boolean {
  return CONTENT_POS.has(token.pos) && token.pos_detail_1 !== "非自立";
}

/** Identifiant stable d'un item (forme de base + lecture pour distinguer les homographes). */
export function itemIdFor(token: KuromojiToken): string {
  const reading = token.reading ? kataToHira(token.reading) : "";
  return `${token.basic_form || token.surface_form}|${reading}`;
}

/** Sens français connu (JMdict-FR) ou tiret si absent. */
export function meaningFor(token: KuromojiToken): string {
  const dict = contentDictSnapshot();
  return dict[token.basic_form] ?? dict[token.surface_form] ?? "—";
}

/**
 * Phrase d'exemple effective d'un item : celle issue d'une histoire lue (contexte vécu,
 * prioritaire), sinon celle du corpus statique. Null si aucune — l'item ne peut alors
 * porter ni exercice d'écoute ni production en contexte.
 */
export function effectiveExample(v: VocabItem): { ja: string; fr?: string } | null {
  return v.example ?? staticExample(v.id);
}

/** Action de l'utilisateur dans le panneau mot. */
export type StatusAction = "known" | "review" | "forgot";

const ACTION_TO_GRADE: Record<StatusAction, SrsGrade> = {
  known: "easy",
  review: "good",
  forgot: "again",
};

const ACTION_TO_STATUS: Record<StatusAction, ItemStatus> = {
  known: "known",
  review: "review",
  forgot: "review",
};

/** Récupère un item existant ou en fabrique un neuf depuis le token. */
async function loadOrCreate(token: KuromojiToken): Promise<VocabItem> {
  const id = itemIdFor(token);
  const existing = await getVocab(id);
  if (existing) return existing;
  return {
    id,
    surface: token.surface_form,
    reading: token.reading ? kataToHira(token.reading) : token.surface_form,
    meaning: meaningFor(token),
    tags: [],
    status: "unknown",
    cards: {},
  };
}

/**
 * Applique une action au token : met à jour le statut, planifie la compétence
 * « reconnaissance écrite » via FSRS, persiste et journalise.
 */
export async function applyStatus(
  token: KuromojiToken,
  action: StatusAction,
  now: Date = new Date(),
): Promise<VocabItem> {
  const item = await loadOrCreate(token);
  item.status = ACTION_TO_STATUS[action];
  const base = item.cards.written ?? newCard(now);
  item.cards.written = review(base, ACTION_TO_GRADE[action], now);
  await putVocab(item);
  await logReview({
    itemId: item.id,
    track: "vocab",
    skill: "written",
    grade: ACTION_TO_GRADE[action],
    at: now.getTime(),
  });
  return item;
}

/** Statuts connus pour une liste d'ids (pour colorer le texte du lecteur). */
export async function statusesFor(ids: string[]): Promise<Map<string, ItemStatus>> {
  const out = new Map<string, ItemStatus>();
  await Promise.all(
    ids.map(async (id) => {
      const v = await getVocab(id);
      if (v) out.set(id, v.status);
    }),
  );
  return out;
}
