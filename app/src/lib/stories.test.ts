import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { saveStory } from "./stories";

describe("saveStory", () => {
  it("retire un titre Markdown en tête (« # … ») laissé par le modèle", async () => {
    const story = await saveStory("# 猫の一日\n\n猫が水を飲む。\n朝、猫はお腹が空く。");
    expect(story.text).toBe("猫が水を飲む。\n朝、猫はお腹が空く。");
    expect(story.title.startsWith("#")).toBe(false);
    expect(story.title).toBe("猫が水を飲む。");
  });

  it("retire plusieurs lignes de titre consécutives", async () => {
    const story = await saveStory("## Titre\n# Sous-titre\n\n本文です。");
    expect(story.text).toBe("本文です。");
  });

  it("laisse intact un texte sans titre", async () => {
    const story = await saveStory("これは普通の文です。\n二行目。");
    expect(story.text).toBe("これは普通の文です。\n二行目。");
  });

  it("conserve le texte original si seul un titre est fourni", async () => {
    const story = await saveStory("# Juste un titre");
    expect(story.text).toBe("# Juste un titre");
  });
});
