import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetDbForTests,
  bumpSrsDaily,
  getMeta,
  localDateString,
  logReview,
  putStory,
  putVocab,
  type VocabItem,
} from "./db";
import {
  CHALLENGES,
  checkOmikuji,
  drawFor,
  drawOmikuji,
  FORTUNES,
  fortuneById,
  markOmikujiSeen,
  shouldOpenOmikuji,
  type OmikujiEnv,
} from "./omikuji";
import { newCard } from "./srs";

const NOW = new Date("2026-07-05T12:00:00");

beforeEach(() => {
  (globalThis as any).indexedDB = new IDBFactory();
  _resetDbForTests();
});

function fullEnv(over: Partial<OmikujiEnv> = {}): OmikujiEnv {
  return {
    dailyGoal: 20,
    reviewedToday: 0,
    productionDue: 10,
    oralDue: 10,
    hasStories: true,
    ...over,
  };
}

describe("drawFor (pur)", () => {
  it("déterministe : même date → même défi et même fortune", () => {
    const a = drawFor("2026-07-05", fullEnv());
    const b = drawFor("2026-07-05", fullEnv());
    expect(a.challenge.id).toBe(b.challenge.id);
    expect(a.fortune).toBe(b.fortune);
  });

  it("varie selon la date (sur un échantillon d'un mois)", () => {
    const draws = new Set(
      Array.from({ length: 30 }, (_, i) =>
        drawFor(`2026-07-${String(i + 1).padStart(2, "0")}`, fullEnv()),
      ).map((d) => `${d.challenge.id}|${d.fortune}`),
    );
    expect(draws.size).toBeGreaterThan(3);
  });

  it("filtre par disponibilité : pas de prod-5 sans carte production due", () => {
    const env = fullEnv({ productionDue: 0, oralDue: 0, hasStories: false });
    for (let i = 1; i <= 28; i++) {
      const { challenge } = drawFor(`2026-02-${String(i).padStart(2, "0")}`, env);
      expect(["reviews-goal", "reviews-stretch", "accuracy-80", "accuracy-90"]).toContain(
        challenge.id,
      );
    }
  });

  it("un défi de compétence n'est tiré que si le jour a de quoi le servir", () => {
    // Trois cartes d'écoute dues ne permettent pas d'en réussir cinq : une carte n'échoit
    // qu'une fois par jour. Le défi « réussis 5 exercices d'écoute » serait perdu d'avance,
    // et l'utilisateur chercherait l'erreur dans ses réglages.
    const maigre = fullEnv({ oralDue: 3, productionDue: 3 });
    for (let i = 1; i <= 28; i++) {
      const { challenge } = drawFor(`2026-03-${String(i).padStart(2, "0")}`, maigre);
      expect(["oral-5", "oral-10", "prod-5", "prod-10"]).not.toContain(challenge.id);
    }
    // Avec cinq cartes dues, le défi à cinq redevient tirable — celui à dix, non.
    const cinq = fullEnv({ oralDue: 5, productionDue: 5 });
    const ids = new Set(
      Array.from({ length: 60 }, (_, i) =>
        drawFor(`2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, "0")}`, cinq),
      ).map((d) => d.challenge.id),
    );
    expect(ids.has("oral-10")).toBe(false);
    expect(ids.has("prod-10")).toBe(false);
  });

  it("repli sur les défis de précision si rien d'autre n'est disponible", () => {
    const env = fullEnv({
      reviewedToday: 35, // objectif et objectif +10 déjà atteints → défis reviews indisponibles
      productionDue: 0,
      oralDue: 0,
      hasStories: false,
    });
    const { challenge } = drawFor("2026-07-05", env);
    expect(["accuracy-80", "accuracy-90"]).toContain(challenge.id);
  });
});

describe("drawOmikuji (IO)", () => {
  it("idempotent : un seul tirage par jour, baseline figée", async () => {
    await bumpSrsDaily(localDateString(NOW), { reviewed: 3 });
    const first = await drawOmikuji(NOW);
    expect(first.baseline.reviewed).toBe(3);
    await bumpSrsDaily(localDateString(NOW), { reviewed: 5 });
    const second = await drawOmikuji(new Date(NOW.getTime() + 3600e3));
    expect(second.drawnAt).toBe(first.drawnAt);
    expect(second.baseline.reviewed).toBe(3);
  });
});

describe("shouldOpenOmikuji (ouverture au lancement)", () => {
  it("s'ouvre tant que la bandelette n'a pas été vue aujourd'hui", async () => {
    expect(await shouldOpenOmikuji(NOW)).toBe(true);
  });

  it("ne se rouvre plus une fois présentée, même sans tirage", async () => {
    await markOmikujiSeen(NOW);
    expect(await shouldOpenOmikuji(NOW)).toBe(false);
  });

  it("un tirage déjà en base vaut « vue » (jours d'avant le drapeau, autre appareil)", async () => {
    await drawOmikuji(NOW);
    expect(await shouldOpenOmikuji(NOW)).toBe(false);
  });

  it("se rouvre le lendemain", async () => {
    await markOmikujiSeen(NOW);
    await drawOmikuji(NOW);
    const tomorrow = new Date(NOW.getTime() + 24 * 3600e3);
    expect(await shouldOpenOmikuji(tomorrow)).toBe(true);
  });
});

describe("checkOmikuji", () => {
  async function seedStoryChallengeDay() {
    // Fabrique un jour où le tirage donne un défi donné : on force l'environnement pour
    // que seuls certains défis soient disponibles, puis on cherche une date qui donne
    // le défi voulu (déterministe → stable dans le temps).
    // Dix mots portant les trois cartes, DUES : les défis de compétence ne se tirent que
    // si la journée a de quoi les servir (cf. `oralDue` / `productionDue`), et `fullEnv`
    // annonce dix — l'environnement réel doit dire la même chose, sinon la date cherchée
    // sur `fullEnv` ne donne pas le même tirage que `drawOmikuji`.
    for (let i = 0; i < 10; i++) {
      const vocab: VocabItem = {
        id: `mot${i}|よみ${i}`,
        surface: `漢${i}`,
        reading: `よみ${i}`,
        meaning: `sens ${i}`,
        tags: [],
        status: "known",
        cards: { written: newCard(NOW), production: newCard(NOW), oral: newCard(NOW) },
      };
      await putVocab(vocab);
    }
    await putStory({
      id: "s1",
      createdAt: NOW.getTime(),
      title: "水",
      text: "水",
      params: {},
    });
  }

  it("null sans tirage du jour", async () => {
    expect(await checkOmikuji(NOW)).toBeNull();
  });

  it("détecte l'accomplissement depuis la baseline et crédite le bonus une seule fois", async () => {
    await seedStoryChallengeDay();
    // Trouve une date dont le tirage est prod-5 (déterministe, donc stable).
    let date = new Date("2026-07-01T12:00:00");
    for (let i = 0; i < 400; i++) {
      const env = fullEnv();
      if (drawFor(localDateString(date), env).challenge.id === "prod-5") break;
      date = new Date(date.getTime() + 24 * 3600e3);
    }
    const rec = await drawOmikuji(date);
    expect(rec.challengeId).toBe("prod-5");

    // 4 productions réussies : pas encore accompli.
    for (let i = 0; i < 4; i++) {
      await logReview({ itemId: `w${i}`, track: "vocab", skill: "production", grade: "good", at: date.getTime() + i });
    }
    let check = await checkOmikuji(date);
    expect(check?.completedNow).toBe(false);
    expect(check?.rec.completedAt).toBeUndefined();

    // La 5ᵉ déclenche l'accomplissement + bonus Tōkaidō (fixé par la fortune tirée).
    const expectedBonus = fortuneById(rec.fortune).bonus;
    await logReview({ itemId: "w5", track: "vocab", skill: "production", grade: "good", at: date.getTime() + 5 });
    check = await checkOmikuji(date);
    expect(check?.completedNow).toBe(true);
    expect(await getMeta<number>("tokaido.bonus")).toBeCloseTo(expectedBonus);

    // Idempotence : re-vérifier ne re-crédite pas.
    check = await checkOmikuji(date);
    expect(check?.completedNow).toBe(false);
    expect(await getMeta<number>("tokaido.bonus")).toBeCloseTo(expectedBonus);
  });

  it("les échecs (again) ne comptent pas dans prodOk", async () => {
    await seedStoryChallengeDay();
    let date = new Date("2026-07-01T12:00:00");
    for (let i = 0; i < 400; i++) {
      if (drawFor(localDateString(date), fullEnv()).challenge.id === "prod-5") break;
      date = new Date(date.getTime() + 24 * 3600e3);
    }
    await drawOmikuji(date);
    for (let i = 0; i < 6; i++) {
      await logReview({ itemId: `w${i}`, track: "vocab", skill: "production", grade: "again", at: date.getTime() + i });
    }
    const check = await checkOmikuji(date);
    expect(check?.completedNow).toBe(false);
  });
});

describe("catalogue", () => {
  it("chaque défi a un libellé et une cible positives", () => {
    const env = fullEnv();
    for (const c of CHALLENGES) {
      expect(c.label(env).length).toBeGreaterThan(0);
      expect(c.target(env)).toBeGreaterThan(0);
    }
  });

  it("chaque fortune a un bonus > 0 (jamais de punition) et un libellé de bonus", () => {
    for (const f of FORTUNES) {
      expect(f.bonus).toBeGreaterThan(0);
      expect(f.weight).toBeGreaterThan(0);
      expect(f.bonusFr.length).toBeGreaterThan(0);
    }
  });

  it("les bonnes fortunes rapportent plus que les mauvaises", () => {
    expect(fortuneById("daikichi").bonus).toBeGreaterThan(fortuneById("kichi").bonus);
    expect(fortuneById("kichi").bonus).toBeGreaterThan(fortuneById("kyo").bonus);
    expect(fortuneById("daikyo").bonus).toBeLessThanOrEqual(fortuneById("kyo").bonus);
  });
});

describe("tirage pondéré des fortunes", () => {
  it("sur un an, la variété est là et les extrêmes restent rares", () => {
    const counts = new Map<string, number>();
    const start = new Date("2026-01-01T12:00:00").getTime();
    for (let i = 0; i < 365; i++) {
      const date = new Date(start + i * 24 * 3600e3).toISOString().slice(0, 10);
      const { fortune } = drawFor(date, fullEnv());
      counts.set(fortune, (counts.get(fortune) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(6);
    const middles =
      (counts.get("kichi") ?? 0) + (counts.get("chukichi") ?? 0) + (counts.get("shokichi") ?? 0);
    expect(counts.get("daikyo") ?? 0).toBeLessThan(middles);
    expect(counts.get("daikichi") ?? 0).toBeLessThan(middles);
  });
});
