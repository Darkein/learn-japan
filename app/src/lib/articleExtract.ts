// Import d'articles japonais (onglet Articles) : fetch via le proxy Worker, extraction
// « mode lecture » côté client (DOMParser + Readability), normalisation vers le format
// texte du lecteur d'histoires, et enregistrement comme StoryRecord marqué `source`.
// N.B. : ne pas confondre avec readability.ts (score de lisibilité JLPT).
import { putStory, type ArticleParagraph, type StoryRecord } from "./db";
import { isKana, isKanji, isJaSentenceEnd } from "./kana";
import { vocabLevel, vocabLevelByForm } from "./inventory";
import { tokenize } from "./tokenizer";
import { baseForm, isContent, itemIdFor } from "./vocab";
import { WORKER_URL } from "./config";

/**
 * Plafond de longueur d'un article importé. Aligné sur les limites du Worker
 * (sentenceList: 200, max_tokens: 4096) : au-delà, la traduction alignée et le QCM
 * seraient tronqués/désalignés. Tronqué à une frontière de phrase.
 */
export const ARTICLE_MAX_CHARS = 6_000;

/** Part minimale de caractères japonais (kana+kanji) parmi les non-espaces. */
const MIN_JA_RATIO = 0.3;

/** Erreur d'import avec message FR affichable tel quel. */
export class ArticleImportError extends Error {}

// Fonctions pures ------------------------------------------------------------

/** Part de kana+kanji parmi les caractères non-espace (0 si texte vide). */
export function japaneseRatio(text: string): number {
  let ja = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    if (isKana(ch) || isKanji(ch)) ja++;
  }
  return total === 0 ? 0 : ja / total;
}

/**
 * Tronque à `max` caractères en reculant jusqu'à la dernière fin de phrase japonaise
 * (ou saut de ligne). Sans frontière trouvée, coupe net à `max`.
 */
export function truncateAtSentenceBoundary(text: string, max: number = ARTICLE_MAX_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  for (let i = head.length - 1; i >= 0; i--) {
    const ch = head[i];
    if (isJaSentenceEnd(ch) || ch === "\n") return head.slice(0, i + 1).trim();
  }
  return head.trim();
}

/** Retire le suffixe « | Site » / « - Site » / « — Site » d'un titre de page. */
export function cleanArticleTitle(title: string): string {
  const t = title.trim().replace(/\s*[|｜\-–—:：]\s*[^|｜\-–—:：]{1,40}$/, "").trim();
  return t || title.trim();
}

/** Normalise des paragraphes : espaces compactés, lignes vides supprimées, joints par \n.
 *  L'espace pleine chasse en tête (indentation typographique japonaise) est retirée. */
export function normalizeArticleParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map((p) => p.replace(/^[\s　]+|[\s　]+$/g, "").replace(/[ \t]+/g, " "))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Comme `normalizeArticleParagraphs`, mais conserve le type (titre/texte) de chaque bloc
 *  source — c'est ce qui permet au lecteur de distinguer titres et paragraphes à l'affichage. */
export function normalizeTypedParagraphs(blocks: ArticleParagraph[]): ArticleParagraph[] {
  return blocks
    .map((b) => ({ type: b.type, text: b.text.replace(/^[\s　]+|[\s　]+$/g, "").replace(/[ \t]+/g, " ") }))
    .filter((b) => b.text.length > 0);
}

/**
 * Recale `paragraphs` sur `text` (potentiellement raccourci par `truncateAtSentenceBoundary`) :
 * les paragraphes tiennent entièrement dans `text` sont gardés, le dernier partiellement
 * couvert est coupé pile à la frontière, le reste est abandonné. `text` doit être un préfixe
 * de `paragraphs.map(p => p.text).join("\n")` (vrai par construction à l'import).
 */
export function truncateParagraphs(paragraphs: ArticleParagraph[], text: string): ArticleParagraph[] {
  const out: ArticleParagraph[] = [];
  let consumed = 0;
  for (const p of paragraphs) {
    if (consumed >= text.length) break;
    const remaining = text.length - consumed;
    if (p.text.length <= remaining) {
      out.push(p);
      consumed += p.text.length + 1; // +1 pour le "\n" qui joint les paragraphes
    } else {
      out.push({ type: p.type, text: p.text.slice(0, remaining) });
      break;
    }
  }
  return out;
}

// Estimation du niveau JLPT ----------------------------------------------------

/**
 * Niveau JLPT estimé depuis les niveaux inventaire des mots de contenu : le niveau le
 * plus accessible dont les mots couvrent ≥ 90 % des occurrences (seuil de la lecture
 * extensive). L'inventaire s'arrête à N3 : au-delà, on distingue N2 (couverture N3
 * encore ≥ 70 %) de N1 (texte majoritairement hors inventaire). Un mot hors inventaire
 * (null) compte comme difficile. Sans mot de contenu, N3 (défaut raisonnable presse).
 */
export function computeJlptLevel(levels: Array<number | null>): number {
  if (levels.length === 0) return 3;
  const coverage = (min: number) =>
    levels.filter((l) => l != null && l >= min).length / levels.length;
  for (const candidate of [5, 4, 3]) {
    if (coverage(candidate) >= 0.9) return candidate;
  }
  return coverage(3) >= 0.7 ? 2 : 1;
}

/**
 * Tokenise le texte et estime son niveau JLPT depuis l'inventaire de vocabulaire.
 * L'id exact `basic_form|lecture` rate les formes conjuguées et les variantes
 * d'écriture : on retombe sur l'index par forme de base (voir vocabLevelByForm).
 */
export async function estimateJlptLevel(text: string): Promise<number> {
  // Noms propres, nombres et suffixes exclus : jamais dans l'inventaire, ils
  // fausseraient l'estimation vers le difficile (fréquents dans un article de presse).
  const tokens = (await tokenize(text)).filter(
    (t) =>
      isContent(t) &&
      t.pos_detail_1 !== "固有名詞" &&
      t.pos_detail_1 !== "数" &&
      t.pos_detail_1 !== "接尾",
  );
  const levels = tokens.map((t) => vocabLevel(itemIdFor(t)) ?? vocabLevelByForm(baseForm(t)));
  return computeJlptLevel(levels);
}

// Enregistrement -------------------------------------------------------------

export interface ArticleInput {
  text: string;
  title?: string;
  url?: string;
  siteName?: string;
  level?: number;
  /** Structure titres/paragraphes source (import URL uniquement) — absent pour un texte collé. */
  paragraphs?: ArticleParagraph[];
}

function makeArticleTitle(text: string): string {
  const firstLine = text.trim().split(/\n/)[0] ?? "";
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine || "Sans titre";
}

/**
 * Enregistre un article comme StoryRecord marqué `source: article`. Volontairement
 * distinct de saveStory() : ses heuristiques anti-écho de titre suppriment les lignes
 * de tête contenant du latin, ce qui mutilerait un article authentique.
 */
export async function saveArticle(input: ArticleInput): Promise<StoryRecord> {
  const text = truncateAtSentenceBoundary(input.text.trim());
  if (!text) throw new ArticleImportError("Le texte de l'article est vide.");
  if (japaneseRatio(text) < MIN_JA_RATIO) {
    throw new ArticleImportError("Ce texte ne semble pas être du japonais.");
  }
  // Niveau JLPT toujours déduit du texte (sauf fourni) : l'utilisateur ne peut pas le
  // connaître, et il paramètre les générations dérivées (exercices, traduction).
  const level = input.level ?? (await estimateJlptLevel(text).catch(() => 3));
  const paragraphs = input.paragraphs ? truncateParagraphs(input.paragraphs, text) : undefined;
  const article: StoryRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    title: input.title?.trim() || makeArticleTitle(text),
    text,
    params: { level },
    ...(paragraphs && paragraphs.length > 0 ? { paragraphs } : {}),
    source: {
      kind: "article",
      ...(input.url ? { url: input.url } : {}),
      ...(input.siteName ? { siteName: input.siteName } : {}),
    },
  };
  await putStory(article);
  return article;
}

// Fetch via le proxy Worker ----------------------------------------------------

export interface FetchedArticle {
  bytes: ArrayBuffer;
  contentType: string;
  finalUrl: string;
}

/** Récupère les octets bruts d'une page via le proxy Worker (contournement CORS). */
export async function fetchArticleBytes(url: string): Promise<FetchedArticle> {
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/article/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ArticleImportError("Page injoignable (réseau ou délai dépassé).");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 400) throw new ArticleImportError(detail || "URL refusée.");
    if (res.status === 413) throw new ArticleImportError("Page trop volumineuse (> 2 Mo).");
    if (res.status === 415) throw new ArticleImportError("Cette URL n'est pas une page HTML.");
    if (res.status === 502) throw new ArticleImportError("Page injoignable.");
    throw new ArticleImportError(`Échec de récupération (HTTP ${res.status}).`);
  }
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("Content-Type") ?? "text/html",
    finalUrl: res.headers.get("X-Final-Url") ?? url,
  };
}

// Décodage + extraction « mode lecture » ---------------------------------------

/**
 * Décode le HTML : charset de l'en-tête Content-Type, sinon sniff des balises
 * <meta charset> / <meta http-equiv> dans les premiers octets, repli UTF-8.
 * TextDecoder gère nativement Shift_JIS et EUC-JP (fréquents sur les sites japonais).
 */
export function decodeHtml(bytes: ArrayBuffer, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    charset =
      /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export interface ExtractedArticle {
  title: string;
  text: string;
  siteName?: string;
  paragraphs: ArticleParagraph[];
}

/** Balises de bloc dont on garde le texte, dans l'ordre du document. */
const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote";

/**
 * Extraction « mode lecture » : Readability sur un document inerte (DOMParser —
 * aucun script exécuté). Les <rt>/<rp> (furigana inline, ex. NHK Easy News) sont
 * supprimés AVANT extraction, sinon textContent produirait « 漢字かんじ ».
 */
export async function extractReadable(html: string, baseUrl: string): Promise<ExtractedArticle> {
  const { Readability } = await import("@mozilla/readability");
  const doc = new DOMParser().parseFromString(html, "text/html");
  try {
    // Résout les URL relatives que Readability inspecte (liens, images).
    const base = doc.createElement("base");
    base.href = baseUrl;
    doc.head.appendChild(base);
  } catch {
    // baseUrl invalide : sans conséquence pour l'extraction du texte.
  }
  for (const el of Array.from(doc.querySelectorAll("rt, rp"))) el.remove();
  const parsed = new Readability(doc).parse();
  if (!parsed?.content) {
    throw new ArticleImportError(
      "Impossible d'extraire l'article (page vide ou paywall) — colle le texte directement.",
    );
  }
  const contentDoc = new DOMParser().parseFromString(parsed.content, "text/html");
  let blocks = Array.from(contentDoc.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
  // Garde les blocs feuilles : un <li> contenant des <p> ne doit pas dupliquer leur texte.
  blocks = blocks.filter((el) => !el.querySelector(BLOCK_SELECTOR));
  // Typé titre/paragraphe par bloc source, pour que le lecteur respecte la mise en page
  // d'origine (titres distincts, paragraphes espacés) — cf. groupTokensByParagraphs.
  const typedLines: ArticleParagraph[] =
    blocks.length > 0
      ? blocks.flatMap((el) => {
          const type: ArticleParagraph["type"] = /^H[1-6]$/.test(el.tagName) ? "heading" : "para";
          return (el.textContent ?? "").split("\n").map((line) => ({ type, text: line }));
        })
      : [{ type: "para", text: contentDoc.body.textContent ?? "" }];
  let paragraphs = normalizeTypedParagraphs(typedLines);
  let text = paragraphs.map((p) => p.text).join("\n");
  // Readability garde souvent le <h1> dans le contenu : on retire cet écho du titre.
  const title = cleanArticleTitle(parsed.title ?? "");
  if (title && paragraphs.length > 1 && paragraphs[0].text === title) {
    paragraphs = paragraphs.slice(1);
    text = paragraphs.map((p) => p.text).join("\n");
  }
  if (!text) {
    throw new ArticleImportError(
      "Impossible d'extraire l'article (page vide ou paywall) — colle le texte directement.",
    );
  }
  return {
    title,
    text,
    paragraphs,
    ...(parsed.siteName ? { siteName: parsed.siteName } : {}),
  };
}

/** Chaîne complète : URL → proxy Worker → décodage → Readability → StoryRecord. */
export async function importArticleFromUrl(url: string): Promise<StoryRecord> {
  const fetched = await fetchArticleBytes(url);
  const html = decodeHtml(fetched.bytes, fetched.contentType);
  const extracted = await extractReadable(html, fetched.finalUrl);
  let siteName = extracted.siteName;
  if (!siteName) {
    try {
      siteName = new URL(fetched.finalUrl).hostname.replace(/^www\./, "");
    } catch {
      siteName = undefined;
    }
  }
  return saveArticle({
    text: extracted.text,
    title: extracted.title,
    url: fetched.finalUrl,
    siteName,
    paragraphs: extracted.paragraphs,
  });
}
