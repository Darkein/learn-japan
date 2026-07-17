// Lien Lecteur ↔ SRS : crée/maj un item de vocabulaire à partir d'un token et applique
// un changement de statut (connu / à revoir / oublié) en planifiant via FSRS.

import { contentDictSnapshot } from "./data";
import type { ContentDict } from "./gloss";
import { kataToHira, normalizeReading } from "./kana";
import {
  allVocab,
  getVocab,
  logReview,
  putVocab,
  type ItemStatus,
  type VocabItem,
} from "./db";
import { resolveVocab, staticExample, type InvVocab } from "./inventory";
import { newCard, review, type SrsGrade } from "./srs";
import { tokenize, type KuromojiToken } from "./tokenizer";

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

/** Forme de base (dictionnaire) d'un token, ou sa surface si kuromoji ne la donne pas. */
export function baseForm(t: KuromojiToken): string {
  return t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form;
}

/**
 * Lecture en kana de la FORME DE BASE d'un token. Si le mot apparaît déjà sous sa forme
 * de base, la lecture du token convient ; sinon (verbe/adjectif conjugué) on retokenise
 * la forme de base pour obtenir sa vraie lecture — fiable même pour les irréguliers
 * (来る→くる vs 来ます→きます), là où une reconstruction depuis la surface se tromperait.
 */
export async function baseReading(t: KuromojiToken): Promise<string> {
  const base = baseForm(t);
  if (t.surface_form === base && t.reading) return normalizeReading(t.reading);
  const sub = await tokenize(base);
  return normalizeReading(sub.map((s) => s.reading ?? s.surface_form).join(""));
}

/**
 * Item vocab neuf depuis un token : stocke la FORME DE DICTIONNAIRE (surface + lecture de
 * base), pas la forme conjuguée rencontrée. Sinon un verbe croisé en します créait un item
 * « し » dont la révision FR → JA (« faire ») refusait する. Si la retokenisation échoue
 * (dico kuromoji indisponible), on retombe sur la forme rencontrée — l'item sera réparé
 * plus tard par repairConjugatedVocab.
 */
export async function newVocabItemFromToken(token: KuromojiToken): Promise<VocabItem> {
  let surface = token.surface_form;
  let reading = token.reading ? kataToHira(token.reading) : token.surface_form;
  try {
    const r = await baseReading(token);
    if (r) {
      surface = baseForm(token);
      reading = r;
    }
  } catch {
    /* forme rencontrée conservée */
  }
  return {
    id: itemIdFor(token),
    surface,
    reading,
    meaning: meaningFor(token),
    tags: [],
    status: "unknown",
    cards: {},
  };
}

/**
 * Répare les items créés avant `newVocabItemFromToken` avec une forme conjuguée en surface
 * (l'id porte la forme de base : « する|し » stocké avec surface « し »). Idempotent, appelé
 * au montage d'une session de révision ; renvoie le nombre d'items corrigés.
 */
export async function repairConjugatedVocab(): Promise<number> {
  const items = await allVocab();
  let updated = 0;
  for (const item of items) {
    const [base] = item.id.split("|");
    if (!base || base === "*" || base === item.surface) continue;
    try {
      const sub = await tokenize(base);
      const reading = normalizeReading(sub.map((s) => s.reading ?? s.surface_form).join(""));
      if (!reading) continue;
      item.surface = base;
      item.reading = reading;
      await putVocab(item);
      updated++;
    } catch {
      /* dico kuromoji indisponible : on réessaiera à la prochaine session */
    }
  }
  return updated;
}

/**
 * Sens français d'un token : JMdict-FR en priorité (forme de base puis surface) ;
 * à défaut, repli sur l'inventaire curé (via `resolveVocab`, qui résout les formes
 * composées « いい; よい » que le tokenizer ne produit jamais). Tiret si rien.
 */
export function meaningFor(token: KuromojiToken): string {
  const dict = contentDictSnapshot();
  const fromDict = dict[token.basic_form] ?? dict[token.surface_form];
  if (fromDict) return fromDict;
  const fromInventory = resolveVocab(itemIdFor(token)).fr;
  return fromInventory || "—";
}

/**
 * Re-dérive le sens figé de tous les items stockés à partir du dictionnaire donné
 * (même chaîne de résolution que `meaningFor`). Appelé une seule fois au premier
 * chargement d'une nouvelle version du dico (voir loadContentDict, lib/data.ts) :
 * les items créés avec une version défectueuse gardaient sinon leur sens erroné
 * (いる → « abattre, tirer ») dans les révisions. Renvoie le nombre d'items corrigés.
 */
export async function refreshStoredMeanings(dict: ContentDict): Promise<number> {
  const items = await allVocab();
  let updated = 0;
  for (const item of items) {
    const [base] = item.id.split("|");
    const fresh =
      dict[base] ?? dict[item.surface] ?? (resolveVocab(item.id).fr || "—");
    if (fresh !== item.meaning) {
      item.meaning = fresh;
      await putVocab(item);
      updated++;
    }
  }
  return updated;
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
  const existing = await getVocab(itemIdFor(token));
  if (existing) return existing;
  return newVocabItemFromToken(token);
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

/**
 * Ajoute un mot de l'inventaire au SRS avec le statut « à revoir » (bouton
 * suggestion de la fiche kanji). Un item déjà en base est retourné tel quel —
 * on ne rétrograde jamais un mot connu.
 */
export async function addInventoryWordToReview(
  v: InvVocab,
  now: Date = new Date(),
): Promise<VocabItem> {
  const existing = await getVocab(v.id);
  if (existing) return existing;
  const item: VocabItem = {
    id: v.id,
    surface: v.ja,
    reading: v.yomi ?? v.ja,
    meaning: v.fr,
    tags: [],
    status: "review",
    cards: { written: review(newCard(now), "good", now) },
  };
  await putVocab(item);
  await logReview({
    itemId: item.id,
    track: "vocab",
    skill: "written",
    grade: "good",
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
