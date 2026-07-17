import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

// Le tokenizer kuromoji charge son dictionnaire par réseau : stubé (comme analyze.test.ts).
// L'estimation JLPT sur tokens vides retombe sur N3 ; la logique est testée via computeJlptLevel.
vi.mock("./tokenizer", () => ({ tokenize: async () => [] }));

import {
  ArticleImportError,
  cleanArticleTitle,
  computeJlptLevel,
  decodeHtml,
  japaneseRatio,
  normalizeArticleParagraphs,
  normalizeTypedParagraphs,
  saveArticle,
  truncateAtSentenceBoundary,
  truncateParagraphs,
} from "./articleExtract";
import { allArticles, allStories } from "./db";

describe("japaneseRatio", () => {
  it("vaut 1 pour un texte purement japonais", () => {
    expect(japaneseRatio("猫が水を飲む。")).toBeGreaterThan(0.8);
  });
  it("vaut ~0 pour un texte latin", () => {
    expect(japaneseRatio("The quick brown fox jumps.")).toBeLessThan(0.1);
  });
  it("ignore les espaces", () => {
    expect(japaneseRatio("  猫  ")).toBe(1);
  });
  it("vaut 0 pour un texte vide", () => {
    expect(japaneseRatio("")).toBe(0);
  });
});

describe("truncateAtSentenceBoundary", () => {
  it("laisse intact un texte sous le plafond", () => {
    expect(truncateAtSentenceBoundary("猫が水を飲む。", 100)).toBe("猫が水を飲む。");
  });
  it("tronque à la dernière fin de phrase", () => {
    const text = "一つ目の文。二つ目の文。三つ目の文は長い";
    expect(truncateAtSentenceBoundary(text, 14)).toBe("一つ目の文。二つ目の文。");
  });
  it("tronque au saut de ligne si pas de ponctuation", () => {
    expect(truncateAtSentenceBoundary("一行目\n二行目の続き", 5)).toBe("一行目");
  });
  it("coupe net sans frontière trouvée", () => {
    expect(truncateAtSentenceBoundary("あいうえおかきくけこ", 4)).toBe("あいうえ");
  });
});

describe("cleanArticleTitle", () => {
  it("retire le suffixe « | Site »", () => {
    expect(cleanArticleTitle("猫のニュース | NHK")).toBe("猫のニュース");
  });
  it("retire le suffixe « - Site »", () => {
    expect(cleanArticleTitle("猫のニュース - 朝日新聞")).toBe("猫のニュース");
  });
  it("garde un titre sans suffixe", () => {
    expect(cleanArticleTitle("猫のニュース")).toBe("猫のニュース");
  });
  it("ne vide pas un titre qui n'est qu'un séparateur+site", () => {
    expect(cleanArticleTitle("NHK NEWS WEB")).toBe("NHK NEWS WEB");
  });
});

describe("normalizeArticleParagraphs", () => {
  it("joint les paragraphes par \\n et supprime les vides", () => {
    expect(normalizeArticleParagraphs(["一段落目。", "", "  ", "二段落目。"])).toBe(
      "一段落目。\n二段落目。",
    );
  });
  it("retire l'indentation pleine chasse et compacte les espaces", () => {
    expect(normalizeArticleParagraphs(["　猫が  水を\t飲む。"])).toBe("猫が 水を 飲む。");
  });
});

describe("normalizeTypedParagraphs", () => {
  it("conserve le type de chaque bloc, retire les vides et compacte les espaces", () => {
    expect(
      normalizeTypedParagraphs([
        { type: "heading", text: "　猫のニュース　" },
        { type: "para", text: "" },
        { type: "para", text: "猫が  水を\t飲む。" },
      ]),
    ).toEqual([
      { type: "heading", text: "猫のニュース" },
      { type: "para", text: "猫が 水を 飲む。" },
    ]);
  });
});

describe("truncateParagraphs", () => {
  it("garde les paragraphes entièrement couverts par le texte tronqué", () => {
    const paragraphs = [
      { type: "heading" as const, text: "猫のニュース" },
      { type: "para" as const, text: "猫が水を飲む。" },
    ];
    const text = paragraphs.map((p) => p.text).join("\n"); // rien de tronqué
    expect(truncateParagraphs(paragraphs, text)).toEqual(paragraphs);
  });

  it("coupe le dernier paragraphe pile à la frontière et abandonne le reste", () => {
    const paragraphs = [
      { type: "heading" as const, text: "見出し" },
      { type: "para" as const, text: "一段落目の文章。" },
      { type: "para" as const, text: "二段落目は切られる。" },
    ];
    const full = paragraphs.map((p) => p.text).join("\n");
    // Coupe au milieu du 2e paragraphe (après « 見出し\n一段落目の文章。\n二段落 »).
    const cut = full.slice(0, full.indexOf("二段落") + "二段落".length);
    expect(truncateParagraphs(paragraphs, cut)).toEqual([
      { type: "heading", text: "見出し" },
      { type: "para", text: "一段落目の文章。" },
      { type: "para", text: "二段落" },
    ]);
  });

  it("retourne un tableau vide si le texte tronqué est vide", () => {
    expect(truncateParagraphs([{ type: "para", text: "猫" }], "")).toEqual([]);
  });
});

describe("decodeHtml", () => {
  it("décode l'UTF-8 par défaut", () => {
    const bytes = new TextEncoder().encode("<html><body>猫</body></html>");
    expect(decodeHtml(bytes.buffer as ArrayBuffer, "text/html")).toContain("猫");
  });
  it("utilise le charset de l'en-tête Content-Type", () => {
    const bytes = new TextEncoder().encode("<html>猫</html>");
    expect(decodeHtml(bytes.buffer as ArrayBuffer, "text/html; charset=utf-8")).toContain("猫");
  });
  it("sniffe le <meta charset> et retombe sur UTF-8 si charset inconnu", () => {
    const bytes = new TextEncoder().encode('<meta charset="invalid-xyz"><p>猫</p>');
    expect(decodeHtml(bytes.buffer as ArrayBuffer, "text/html")).toContain("猫");
  });
});

describe("computeJlptLevel", () => {
  it("N5 si ≥ 90 % des mots sont N5", () => {
    expect(computeJlptLevel([5, 5, 5, 5, 5, 5, 5, 5, 5, 4])).toBe(5);
  });
  it("descend au niveau couvrant 90 % des occurrences", () => {
    expect(computeJlptLevel([5, 5, 5, 3, 3, 3, 3, 3, 3, 3])).toBe(3);
  });
  it("N2 si la couverture N3 reste ≥ 70 % (inventaire borné à N3)", () => {
    expect(computeJlptLevel([3, 3, 3, 3, 3, 3, 3, 3, null, null])).toBe(2);
  });
  it("N1 si les mots hors inventaire dominent", () => {
    expect(computeJlptLevel([null, null, null, 5, 5])).toBe(1);
  });
  it("N3 par défaut sans mots de contenu", () => {
    expect(computeJlptLevel([])).toBe(3);
  });
});

describe("saveArticle", () => {
  it("enregistre un article marqué source et le liste dans allArticles, pas allStories", async () => {
    const article = await saveArticle({
      text: "NHKのニュースです。猫が水を飲む。",
      title: "猫のニュース",
      url: "https://example.jp/news/1",
      siteName: "example.jp",
      level: 3,
    });
    expect(article.source).toEqual({
      kind: "article",
      url: "https://example.jp/news/1",
      siteName: "example.jp",
    });
    expect(article.params.level).toBe(3);
    const articles = await allArticles();
    expect(articles.some((a) => a.id === article.id)).toBe(true);
    const stories = await allStories();
    expect(stories.some((s) => s.id === article.id)).toBe(false);
  });

  it("ne mutile pas un texte commençant par du latin (contrairement à saveStory)", async () => {
    const article = await saveArticle({ text: "iPhoneの新しい機能が発表された。日本でも人気だ。" });
    expect(article.text).toBe("iPhoneの新しい機能が発表された。日本でも人気だ。");
  });

  it("dérive un titre de la première ligne si absent, et estime le niveau JLPT", async () => {
    const article = await saveArticle({ text: "短い記事です。\n二行目。" });
    expect(article.title).toBe("短い記事です。");
    expect(article.params.level).toBe(3); // tokenizer stubé → estimation par défaut
  });

  it("refuse un texte non japonais", async () => {
    await expect(saveArticle({ text: "This is an English article only." })).rejects.toThrow(
      ArticleImportError,
    );
  });

  it("refuse un texte vide", async () => {
    await expect(saveArticle({ text: "   " })).rejects.toThrow(ArticleImportError);
  });

  it("tronque un article trop long à une frontière de phrase", async () => {
    const sentence = "これはとても長い記事のための一つの文です。";
    const text = sentence.repeat(400); // ~8 400 caractères
    const article = await saveArticle({ text });
    expect(article.text.length).toBeLessThanOrEqual(6000);
    expect(article.text.endsWith("。")).toBe(true);
  });

  it("conserve la structure titre/paragraphes fournie", async () => {
    const paragraphs = [
      { type: "heading" as const, text: "猫のニュース" },
      { type: "para" as const, text: "猫が水を飲む。" },
    ];
    const article = await saveArticle({ text: paragraphs.map((p) => p.text).join("\n"), paragraphs });
    expect(article.paragraphs).toEqual(paragraphs);
  });

  it("recale les paragraphes sur le texte tronqué à une frontière de phrase", async () => {
    const sentence = "これはとても長い記事のための一つの文です。";
    const paragraphs = [
      { type: "heading" as const, text: "長い記事" },
      { type: "para" as const, text: sentence.repeat(400) },
    ];
    const article = await saveArticle({ text: paragraphs.map((p) => p.text).join("\n"), paragraphs });
    expect(article.paragraphs?.map((p) => p.text).join("\n")).toBe(article.text);
  });
});
