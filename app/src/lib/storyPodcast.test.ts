import { describe, expect, it } from "vitest";
import type { AnnotatedToken } from "./furigana";
import { buildStorySegments } from "./storyPodcast";

function toks(...surfaces: string[]): AnnotatedToken[] {
  return surfaces.map((surface) => ({ surface }) as AnnotatedToken);
}

describe("buildStorySegments", () => {
  it("crée un segment histoire par phrase avec tokens et index global", () => {
    const segs = buildStorySegments(toks("猫", "は", "寝る", "。", "犬", "も", "寝る", "。"));
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ chapter: "histoire", lang: "ja", baseTokenIndex: 0 });
    expect(segs[0].tokens).toEqual(["猫", "は", "寝る", "。"]);
    expect(segs[0].text).toBe("猫は寝る。");
    expect(segs[1].baseTokenIndex).toBe(4);
    expect(segs[1].id).not.toBe(segs[0].id);
  });

  it("propage le storyId sur chaque segment (surlignage piloté par segment)", () => {
    const segs = buildStorySegments(toks("猫", "。", "犬", "。"), "s1");
    expect(segs.every((s) => s.storyId === "s1")).toBe(true);
  });

  it("tronque le label des phrases longues", () => {
    const long = "あ".repeat(40);
    const segs = buildStorySegments(toks(long, "。"));
    expect(segs[0].label!.length).toBeLessThanOrEqual(25);
    expect(segs[0].label!.endsWith("…")).toBe(true);
  });
});
