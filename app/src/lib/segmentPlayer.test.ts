import { describe, expect, it } from "vitest";
import { tokenAtTime } from "./segmentPlayer";

describe("tokenAtTime", () => {
  const marks = [
    { i: 4, t: 0 },
    { i: 5, t: 0.5 },
    { i: 6, t: 1.2 },
  ];
  it("renvoie null avant le premier mark", () => {
    expect(tokenAtTime([{ i: 4, t: 0.3 }], 0.1)).toBeNull();
  });
  it("renvoie l'index du dernier mark franchi", () => {
    expect(tokenAtTime(marks, 0)).toBe(4);
    expect(tokenAtTime(marks, 0.6)).toBe(5);
    expect(tokenAtTime(marks, 5)).toBe(6);
  });
});
