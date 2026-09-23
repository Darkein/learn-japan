import { describe, expect, it } from "vitest";
import type { VocabItem } from "./db";
import { SRS } from "./config";
import { newCard, State } from "./srs";
import {
  DRILL_KINDS,
  drillEligible,
  orderDrills,
  skillOf,
  type DrillKind,
} from "./vocabDrills";

const NOW = new Date("2026-06-23T08:00:00Z");

/** Mot mûr par défaut : état Review, intervalle au-dessus du seuil de déblocage. */
function word(p: Partial<VocabItem> = {}): VocabItem {
  return {
    id: "水|みず",
    surface: "水",
    reading: "みず",
    meaning: "eau",
    tags: [],
    status: "review",
    card: {
      ...newCard(NOW),
      state: State.Review,
      scheduled_days: SRS.unlockIntervalDays,
      reps: 3,
    },
    ...p,
  };
}

const WITH_EXAMPLE = { hasExample: true };

describe("drillEligible", () => {
  it("l'écrit est toujours recevable — c'est le filet du tirage", () => {
    expect(drillEligible(word({ card: undefined }), "written")).toBe(true);
    expect(drillEligible(word({ card: newCard(NOW) }), "written", { silent: true })).toBe(true);
  });

  it("rien d'autre que l'écrit sur un mot qui n'est pas encore stabilisé", () => {
    // On ne fait pas écouter — ni produire — un mot qu'on vient de rencontrer.
    const fresh = word({ card: newCard(NOW) });
    for (const k of DRILL_KINDS.filter((k) => k !== "written")) {
      expect(drillEligible(fresh, k, WITH_EXAMPLE)).toBe(false);
    }
  });

  it("sans le son, aucune forme d'oreille", () => {
    const w = word();
    for (const k of ["listen-word", "listen-meaning", "dictation"] as DrillKind[]) {
      expect(drillEligible(w, k, { ...WITH_EXAMPLE, silent: true })).toBe(false);
    }
    // La production, elle, ne demande pas le son.
    expect(drillEligible(w, "production", { ...WITH_EXAMPLE, silent: true })).toBe(true);
  });

  it("sans phrase d'exemple, seule la dictée du MOT reste jouable", () => {
    const w = word();
    expect(drillEligible(w, "listen-word", {})).toBe(true);
    expect(drillEligible(w, "listen-meaning", {})).toBe(false);
    expect(drillEligible(w, "dictation", {})).toBe(false);
    expect(drillEligible(w, "production", {})).toBe(false);
  });

  it("la production attend l'intervalle de déblocage", () => {
    const jeune = word({
      card: { ...word().card!, scheduled_days: SRS.unlockIntervalDays - 1 },
    });
    expect(drillEligible(jeune, "production", WITH_EXAMPLE)).toBe(false);
    expect(drillEligible(jeune, "listen-word", WITH_EXAMPLE)).toBe(true);
  });
});

describe("orderDrills", () => {
  it("propose les cinq formes d'un mot mûr, l'écrit toujours présent", () => {
    const order = orderDrills(word(), WITH_EXAMPLE);
    expect(order.sort()).toEqual([...DRILL_KINDS].sort());
  });

  it("relègue en dernier la forme du passage précédent", () => {
    for (let i = 0; i < 20; i++) {
      const order = orderDrills(word({ lastDrill: "written" }), WITH_EXAMPLE);
      expect(order[order.length - 1]).toBe("written");
    }
  });

  it("garde quand même la forme précédente en repli (aucune impasse)", () => {
    // Mot sans exemple et sans le son : l'écrit est la SEULE forme recevable. Même s'il
    // vient d'être servi, il doit rester dans la liste — sinon le mot n'a plus d'exercice.
    const order = orderDrills(word({ lastDrill: "written" }), { silent: true });
    expect(order).toEqual(["written"]);
  });

  it("l'écrit sort plus souvent que les autres (il porte la série de saisie)", () => {
    const counts = new Map<DrillKind, number>();
    for (let i = 0; i < 1000; i++) {
      const first = orderDrills(word(), WITH_EXAMPLE)[0];
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    const written = counts.get("written") ?? 0;
    // Poids 2 contre 1 sur cinq formes ≈ 33 % ; large marge pour le hasard.
    expect(written).toBeGreaterThan(220);
    expect(written).toBeLessThan(450);
    // ... sans jamais écraser les autres : chacune sort.
    for (const k of DRILL_KINDS) expect(counts.get(k) ?? 0).toBeGreaterThan(0);
  });

  it("prefer : les formes de la compétence visée passent devant, sans rien retirer", () => {
    const ORAL: DrillKind[] = ["listen-word", "listen-meaning", "dictation"];
    for (let i = 0; i < 50; i++) {
      const order = orderDrills(word(), { ...WITH_EXAMPLE, prefer: "oral" });
      expect(order.slice(0, 3).sort()).toEqual([...ORAL].sort());
      expect([...order].sort()).toEqual([...DRILL_KINDS].sort());
    }
  });

  it("prefer l'emporte sur la relégation de la forme précédente", () => {
    // Le jour d'un défi de production, la production reste la première servie même si
    // elle vient de l'être : c'est la seule forme de la compétence.
    for (let i = 0; i < 20; i++) {
      const order = orderDrills(word({ lastDrill: "production" }), {
        ...WITH_EXAMPLE,
        prefer: "production",
      });
      expect(order[0]).toBe("production");
    }
  });
});

describe("skillOf", () => {
  it("les trois formes d'oreille comptent pour une seule compétence", () => {
    expect(skillOf("listen-word")).toBe("oral");
    expect(skillOf("listen-meaning")).toBe("oral");
    expect(skillOf("dictation")).toBe("oral");
    expect(skillOf("written")).toBe("written");
    expect(skillOf("production")).toBe("production");
  });
});
