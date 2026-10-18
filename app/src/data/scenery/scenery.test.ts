import { describe, expect, it } from "vitest";
import { ROUTES } from "../routes";
import { UNIQUES } from "../../lib/scenery";
import { SCENERIES } from "./index";

describe("le décor réel des routes", () => {
  it("décrit chaque ville de chaque route, avec sa lecture en kana", () => {
    for (const route of ROUTES) {
      const s = SCENERIES.find((x) => x.level === route.level);
      expect(s, route.name).toBeDefined();
      expect(s!.cities).toHaveLength(route.stations.length);
      s!.cities.forEach((c, i) => expect(c.kana, `${route.name} ${i}`).toMatch(/^[ぁ-ゖー]+$/));
    }
  });

  it("donne aux routes des tailles variées, et à chaque illustration sa place connue", () => {
    for (const s of SCENERIES) {
      const sizes = new Set(s.cities.map((c) => c.size ?? "ville"));
      expect(sizes.has("village")).toBe(true);
      for (const c of s.cities) if (c.unique) expect(UNIQUES[c.unique]).toBeDefined();
    }
    // Les deux exceptions des estampes.
    const tokaido = SCENERIES.find((s) => s.level === 5)!;
    expect(tokaido.cities[15]).toMatchObject({ forced: "snow" }); // Kanbara
    expect(tokaido.cities[45]).toMatchObject({ forced: "rain" }); // Shōno
  });

  it("place chaque illustration unique de la SPEC une fois au moins", () => {
    const used = new Set(SCENERIES.flatMap((s) => s.cities.map((c) => c.unique)).filter(Boolean));
    for (const k of Object.keys(UNIQUES)) expect(used.has(k as never), k).toBe(true);
  });
});
