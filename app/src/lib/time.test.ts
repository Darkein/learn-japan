import { describe, expect, it } from "vitest";
import { formatDaysAgo, formatMinutes } from "./time";

const NOW = new Date("2026-07-05T12:00:00");

describe("formatDaysAgo", () => {
  it("gère aujourd'hui / hier / jours / mois / ans", () => {
    expect(formatDaysAgo(new Date("2026-07-05T01:00:00").getTime(), NOW)).toBe("aujourd'hui");
    expect(formatDaysAgo(new Date("2026-07-04T23:00:00").getTime(), NOW)).toBe("hier");
    expect(formatDaysAgo(new Date("2026-06-23T12:00:00").getTime(), NOW)).toBe("il y a 12 jours");
    expect(formatDaysAgo(new Date("2026-04-05T12:00:00").getTime(), NOW)).toBe("il y a 3 mois");
    expect(formatDaysAgo(new Date("2024-07-05T12:00:00").getTime(), NOW)).toBe("il y a 2 ans");
  });

  it("ne renvoie jamais de futur (horloge légèrement décalée)", () => {
    expect(formatDaysAgo(new Date("2026-07-05T13:00:00").getTime(), NOW)).toBe("aujourd'hui");
  });
});

describe("formatMinutes", () => {
  it("minutes puis heures", () => {
    expect(formatMinutes(5 * 60000)).toBe("5 min");
    expect(formatMinutes(60 * 60000)).toBe("1 h");
    expect(formatMinutes(65 * 60000)).toBe("1 h 05");
  });
});
