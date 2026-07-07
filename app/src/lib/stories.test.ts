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

  it("retire un titre recopié dans le corps (JP + FR) après la ligne TITRE:", async () => {
    const story = await saveStory(
      "TITRE: 猫と水 | Le chat et l'eau\n猫と水 / Le chat et l'eau\n\n猫が水を飲む。\n朝、猫はお腹が空く。",
    );
    expect(story.title).toBe("猫と水");
    expect(story.titleFr).toBe("Le chat et l'eau");
    expect(story.text).toBe("猫が水を飲む。\n朝、猫はお腹が空く。");
  });

  it("retire un titre japonais recopié en tête du corps (en-tête Markdown)", async () => {
    const story = await saveStory("TITRE: 猫と水 | Le chat et l'eau\n# 猫と水\n猫が水を飲む。");
    expect(story.text).toBe("猫が水を飲む。");
  });

  it("retire une ligne de titre français seule recopiée dans le corps", async () => {
    const story = await saveStory("TITRE: 猫と水 | Le chat et l'eau\nLe chat et l'eau\n猫が水を飲む。");
    expect(story.text).toBe("猫が水を飲む。");
  });

  it("ne retire PAS une vraie phrase qui contient les mots du titre", async () => {
    // Le titre « 猫と水 » est un sous-ensemble de la première phrase, mais ce n'est pas
    // un écho (ligne japonaise réelle, pas égale au titre) : on la garde.
    const story = await saveStory("TITRE: 猫と水 | Le chat et l'eau\n猫と水の話を始めます。\n猫が水を飲む。");
    expect(story.text).toBe("猫と水の話を始めます。\n猫が水を飲む。");
  });
});
