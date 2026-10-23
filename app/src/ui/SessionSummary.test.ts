import { describe, expect, it } from "vitest";
import { SRS } from "../lib/config";
import { PRODUCTION_MIN_DAYS } from "../lib/vocabDrills";
import type { ChoiceExercise, TypeExercise } from "../lib/exercise";
import { blankAnswer, groupResults, summaryBadge } from "./SessionSummary";

/** Entrée de bilan minimale : seuls les champs lus par `summaryBadge`. */
function entry(over: Partial<Parameters<typeof summaryBadge>[0]> = {}) {
  return { mastered: false, intervalDays: 0, intervalDaysBefore: 0, ...over };
}

describe("summaryBadge", () => {
  it("un élément jamais stabilisé est « nouveau »", () => {
    expect(summaryBadge(entry())).toEqual({ label: "nouveau", variant: "default" });
  });

  it("un élément qui tenait plusieurs jours et retombe à zéro est « oublié », pas « nouveau »", () => {
    expect(summaryBadge(entry({ intervalDaysBefore: 8 }))).toEqual({
      label: "oublié",
      variant: "default",
    });
  });

  it("l'élément maîtrisé est le seul palier haut qui porte un badge", () => {
    const e = entry({ mastered: true, intervalDays: SRS.masteredIntervalDays });
    expect(summaryBadge(e)).toEqual({ label: "maîtrisé", variant: "accent" });
  });

  it("le seuil d'ouverture de la production ne porte AUCUN badge : il sert l'app, pas l'apprenant", () => {
    expect(summaryBadge(entry({ intervalDays: PRODUCTION_MIN_DAYS }))).toBeNull();
  });

  it("tout l'entre-deux reste sans badge : la barre raconte la progression", () => {
    expect(summaryBadge(entry({ intervalDays: 2, intervalDaysBefore: 1 }))).toBeNull();
    expect(summaryBadge(entry({ intervalDays: SRS.masteredIntervalDays - 1 }))).toBeNull();
  });
});

describe("blankAnswer", () => {
  const typed = (over: Partial<TypeExercise> = {}): TypeExercise => ({
    mode: "type", key: "k", track: "vocab", id: "咲く|さく", front: "花が◯◯。", back: "咲く（さく）", answers: [], ...over,
  });

  it("nomme le mot de la carte, sans sa lecture", () => {
    expect(blankAnswer(typed())).toBe("咲く");
  });

  it("préfère la forme attendue dans la phrase", () => {
    expect(blankAnswer(typed({ front: "宿題を◯◯ます。", back: "する", blankForm: "し" }))).toBe("し");
  });

  it("donne la bonne particule d'un QCM", () => {
    const ex: ChoiceExercise = {
      mode: "choice", key: "k", track: "grammar", id: "g", front: "本＿読む", back: "本を読む", choices: ["は", "を", "に"], answerIndex: 1,
    };
    expect(blankAnswer(ex)).toBe("を");
  });
});

describe("groupResults", () => {
  const card = (id: string, track: "vocab" | "grammar" = "vocab", front = id): TypeExercise => ({
    mode: "type", key: `${id}:${front}`, track, id, front, back: id, answers: [],
  });

  it("garde un élément revu deux fois une seule fois, avec son état d'avant la session", () => {
    const grouped = groupResults([
      { card: card("大人|おとな", "vocab", "adulte"), daysBefore: 0 },
      { card: card("男の子|おとこのこ"), daysBefore: 3 },
      { card: card("大人|おとな", "vocab", "大人"), daysBefore: 1 },
    ]);
    expect(grouped.map((r) => [r.card.id, r.daysBefore])).toEqual([
      ["大人|おとな", 0],
      ["男の子|おとこのこ", 3],
    ]);
  });

  it("distingue un mot et un point de grammaire de même id", () => {
    expect(groupResults([{ card: card("x"), daysBefore: 0 }, { card: card("x", "grammar"), daysBefore: 0 }])).toHaveLength(2);
  });
});
