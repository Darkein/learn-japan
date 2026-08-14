// Lien Lecteur ↔ SRS : crée/maj un item de vocabulaire à partir d'un token et applique
// un changement de statut (connu / à revoir / oublié) en planifiant via FSRS.

import { contentDictSnapshot } from "./data";
import type { ContentDict } from "./gloss";
import { hasJapanese, kataToHira, normalizeReading } from "./kana";
import {
  allVocab,
  deleteVocab,
  getMeta,
  getVocab,
  logReview,
  putMeta,
  putVocab,
  type ItemStatus,
  type VocabItem,
} from "./db";
import { resolveVocab, staticExample, vocabLevel, type InvVocab } from "./inventory";
import { newCard, review, spaceSkillCards, type SrsGrade } from "./srs";
import { tokenize, type KuromojiToken } from "./tokenizer";

const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞"]);

/**
 * Nom propre (personne, lieu, organisation) à NE PAS suivre en vocabulaire. Apprendre
 * « 田中 » ou « 朝日新聞 » n'apporte rien — et le JMdict n'indexant pas les noms propres,
 * ces items arrivaient en révision avec un sens « — », question sans réponse possible.
 *
 * L'inventaire curé l'emporte toujours sur l'étiquette du tokenizer : hors contexte,
 * IPADIC classe 固有名詞 quantité de mots courants (池, 森, 毎日, 日本…), et c'est justement
 * la graphie stockée qu'on retokenise à la purge. Un mot du référentiel JLPT reste donc
 * suivi (日本, アメリカ, ヨーロッパ…), quelle que soit l'étiquette rendue.
 */
export function isProperNoun(token: KuromojiToken): boolean {
  return token.pos_detail_1 === "固有名詞" && vocabLevel(itemIdFor(token)) == null;
}

/**
 * Un token porte-t-il du sens lexical (candidat au SRS vocabulaire) ? On exige au moins un
 * caractère japonais : les mots latins et les nombres, étiquetés 名詞/固有名詞 par kuromoji
 * faute d'entrée dans IPADIC, n'ont ni lecture ni forme de base — les suivre revenait à
 * souligner et gloser du texte anglais, tous fondus sur le même id « *| ». Les noms propres
 * hors référentiel sont exclus au même titre (voir isProperNoun) : c'est LE filtre commun
 * au SRS, au soulignement du lecteur et aux mesures de couverture.
 */
export function isContent(token: KuromojiToken): boolean {
  return (
    CONTENT_POS.has(token.pos) &&
    token.pos_detail_1 !== "非自立" &&
    hasJapanese(token.surface_form) &&
    !isProperNoun(token)
  );
}

/**
 * Identifiant stable d'un item (forme de base + lecture pour distinguer les homographes).
 * `baseForm` retombe sur la surface quand kuromoji ne donne pas de forme de base (`*`),
 * sinon deux mots inconnus distincts partageraient l'id « *| ».
 */
export function itemIdFor(token: KuromojiToken): string {
  const reading = token.reading ? kataToHira(token.reading) : "";
  return `${baseForm(token)}|${reading}`;
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

/** Drapeau `meta` de la purge des noms propres : une seule passe complète suffit. */
const PROPER_NOUN_PURGE_KEY = "purge.properNouns";

/**
 * Supprime les items de vocabulaire qui sont des noms propres — créés avant que `isContent`
 * ne les écarte, ils remontaient en révision (« 田中 » → sens « — »). La nature grammaticale
 * n'étant pas stockée, on retokenise la graphie : un item purgé est donc un mot dont la
 * graphie SEULE s'analyse en 固有名詞 et qui n'est pas au référentiel JLPT.
 *
 * Passe unique (drapeau `meta`), appelée au montage d'une session : plus aucun nom propre
 * ne peut entrer ensuite. Le drapeau n'est posé que si TOUS les items ont pu être analysés
 * — dictionnaire kuromoji indisponible ⇒ on réessaiera à la session suivante.
 * Renvoie le nombre d'items supprimés.
 */
export async function purgeProperNouns(): Promise<number> {
  if (await getMeta<boolean>(PROPER_NOUN_PURGE_KEY)) return 0;
  const items = await allVocab();
  let removed = 0;
  let complete = true;
  for (const item of items) {
    // Mot du référentiel : jamais un nom propre, inutile de le retokeniser.
    if (vocabLevel(item.id) != null) continue;
    let tokens: KuromojiToken[];
    try {
      tokens = await tokenize(item.surface);
    } catch {
      complete = false;
      continue;
    }
    // Graphie qui se découpe en plusieurs mots : ce n'est pas un nom propre isolé.
    if (tokens.length !== 1 || !isProperNoun(tokens[0])) continue;
    await deleteVocab(item.id);
    removed++;
  }
  if (complete) await putMeta(PROPER_NOUN_PURGE_KEY, true);
  return removed;
}

/**
 * Sens français d'un token. L'inventaire curé passe EN PREMIER : il est indexé par
 * graphie + LECTURE (`本|ほん`), donc il désambiguïse les homographes que le JMdict, indexé
 * par graphie SEULE, confond — dict["本"] renvoie « base, origine » (もと) alors que le mot
 * lu ほん veut dire « livre ». Repli JMdict (forme de base puis surface) pour les mots hors
 * inventaire ; tiret si rien.
 */
export function meaningFor(token: KuromojiToken): string {
  const fromInventory = resolveVocab(itemIdFor(token)).fr;
  if (fromInventory) return fromInventory;
  const dict = contentDictSnapshot();
  return dict[token.basic_form] ?? dict[token.surface_form] ?? "—";
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
    // Même priorité que `meaningFor` : inventaire curé (par graphie+lecture) d'abord,
    // repli JMdict (par graphie) ensuite.
    const fresh =
      resolveVocab(item.id).fr || dict[base] || dict[item.surface] || "—";
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
 * Matérialise en base les mots de contenu d'un texte et renvoie leurs ids, dédoublonnés.
 * Les exercices d'une histoire passent par le même assembleur que la révision, qui
 * travaille sur des `VocabItem` — or un mot croisé dans une histoire n'est pas forcément
 * déjà en base. Ne touche NI au statut NI aux cartes FSRS : un mot rencontré n'est pas un
 * mot appris, il n'entre en planification que via `buildSession`.
 */
export async function ensureVocabItems(tokens: KuromojiToken[]): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (!isContent(t)) continue;
    const id = itemIdFor(t);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (!(await getVocab(id))) await putVocab(await newVocabItemFromToken(t));
  }
  return ids;
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
  // Le mot vient d'être travaillé (tap du Lecteur, reconstruction de phrase) : ses cartes
  // d'écoute et de production ne repassent pas dans la foulée (cf. spaceSkillCards).
  spaceSkillCards(item.cards, "written", now);
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
