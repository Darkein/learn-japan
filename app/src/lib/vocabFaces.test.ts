import { describe, expect, it } from "vitest";
import type { VocabItem } from "./db";
import {
  availableFaces,
  dirKey,
  directionsFor,
  faceText,
  orderDirections,
  pickInputMode,
  promptFor,
  TYPE_STREAK,
} from "./vocabFaces";

function vocab(over: Partial<VocabItem> & { id: string }): VocabItem {
  const [surface, reading] = over.id.split("|");
  return {
    surface,
    reading,
    meaning: "—",
    tags: [],
    status: "review",
    cards: {},
    ...over,
  };
}

describe("availableFaces", () => {
  it("mot complet : kanji, lecture et sens", () => {
    expect(availableFaces(vocab({ id: "猫|ねこ", meaning: "chat" }))).toEqual([
      "kanji",
      "kana",
      "fr",
    ]);
  });

  it("mot en kana seul : pas de face kanji", () => {
    expect(availableFaces(vocab({ id: "ねこ|ねこ", meaning: "chat" }))).toEqual(["kana", "fr"]);
  });

  it("sens inconnu (« — ») : pas de face française", () => {
    expect(availableFaces(vocab({ id: "猫|ねこ" }))).toEqual(["kanji", "kana"]);
  });

  it("graphie identique à la lecture : pas de face kanji, même en katakana", () => {
    // ネコ / ねこ ne diffèrent que par la casse kana : demander « la graphie » de ねこ
    // serait une recopie, pas un exercice.
    expect(availableFaces(vocab({ id: "ネコ|ねこ", meaning: "chat" }))).toEqual(["kana", "fr"]);
  });

  it("faceText rend le contenu de chaque face", () => {
    const v = vocab({ id: "猫|ねこ", meaning: "chat" });
    expect(faceText(v, "kanji")).toBe("猫");
    expect(faceText(v, "kana")).toBe("ねこ");
    expect(faceText(v, "fr")).toBe("chat");
  });
});

describe("directionsFor", () => {
  it("mot complet : les six directions, jamais une face vers elle-même", () => {
    const dirs = directionsFor(vocab({ id: "猫|ねこ", meaning: "chat" }));
    expect(dirs).toHaveLength(6);
    expect(new Set(dirs.map(dirKey)).size).toBe(6);
    for (const d of dirs) expect(d.from).not.toBe(d.to);
  });

  it("mot à deux faces : les deux directions", () => {
    expect(directionsFor(vocab({ id: "ねこ|ねこ", meaning: "chat" })).map(dirKey)).toEqual(
      expect.arrayContaining(["kana>fr", "fr>kana"]),
    );
    expect(directionsFor(vocab({ id: "猫|ねこ" }))).toHaveLength(2);
  });
});

describe("orderDirections", () => {
  const dirs = directionsFor(vocab({ id: "猫|ねこ", meaning: "chat" }));

  it("relègue la direction du passage précédent en dernier", () => {
    for (const d of dirs) {
      const ordered = orderDirections(dirs, dirKey(d));
      expect(dirKey(ordered[ordered.length - 1])).toBe(dirKey(d));
    }
  });

  it("conserve toutes les directions et varie leur ordre", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const ordered = orderDirections(dirs);
      expect(ordered).toHaveLength(dirs.length);
      firsts.add(dirKey(ordered[0]));
    }
    expect(firsts.size).toBe(dirs.length); // toutes peuvent sortir en tête
  });

  it("une seule direction possible : elle ressort même si c'est la précédente", () => {
    const only = [{ from: "fr" as const, to: "kana" as const }];
    expect(orderDirections(only, "fr>kana")).toEqual(only);
  });
});

describe("pickInputMode", () => {
  it("cible kanji ou traduction : toujours du QCM (pas typables)", () => {
    for (const streak of [0, TYPE_STREAK, TYPE_STREAK + 10]) {
      expect(pickInputMode("kanji", streak)).toBe("choice");
      expect(pickInputMode("fr", streak)).toBe("choice");
    }
  });

  it("cible lecture : QCM sous le seuil, saisie au-dessus", () => {
    expect(pickInputMode("kana", TYPE_STREAK - 1)).toBe("choice");
    expect(pickInputMode("kana", TYPE_STREAK)).toBe("type");
    expect(pickInputMode("kana", TYPE_STREAK + 3)).toBe("type");
  });

  it("élément difficile : retour au QCM quel que soit le compteur", () => {
    expect(pickInputMode("kana", TYPE_STREAK + 10, true)).toBe("choice");
  });

  it("compteur absent = jamais révisé → QCM", () => {
    expect(pickInputMode("kana")).toBe("choice");
  });
});

describe("promptFor", () => {
  it("la consigne dépend de la face demandée et du mode", () => {
    expect(promptFor("kana", "type")).toContain("kana");
    expect(promptFor("kana", "choice")).toContain("lecture");
    expect(promptFor("kanji", "choice")).toContain("écriture");
    expect(promptFor("fr", "choice")).toContain("signifie");
  });
});
