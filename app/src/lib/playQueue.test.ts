import { describe, expect, it } from "vitest";
import { endAction, nextMode, reorder } from "./playQueue";

describe("reorder", () => {
  it("déplace un élément vers l'avant", () => {
    expect(reorder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("déplace un élément vers l'arrière", () => {
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
});

describe("endAction", () => {
  it("avance tant qu'il reste des éléments en file", () => {
    expect(endAction("once", true)).toBe("advance");
    expect(endAction("auto", true)).toBe("advance");
  });
  it("file épuisée : dépend du mode", () => {
    expect(endAction("auto", false)).toBe("append");
    expect(endAction("repeat", false)).toBe("loop");
    expect(endAction("once", false)).toBe("stop");
  });
});

describe("nextMode", () => {
  it("cycle auto → repeat → once → auto", () => {
    expect(nextMode("auto")).toBe("repeat");
    expect(nextMode("repeat")).toBe("once");
    expect(nextMode("once")).toBe("auto");
  });
});
