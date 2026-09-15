// Le retard de révision reste-t-il BORNÉ ? Aucun test unitaire ne peut répondre : la
// question porte sur la boucle complète (introduction de nouveautés → cartes FSRS → dû du
// lendemain → frein du débit), sur des semaines. D'où une simulation : on joue le flux d'un
// utilisateur régulier, jour après jour, et on regarde la trajectoire du dû.
//
// C'est le test de non-régression du bug « chaque jour j'ai dix mots à consolider de plus » :
// avec un objectif de 10 cartes/jour et 10 mots neufs/jour, le dû montait indéfiniment
// (+133 en trois mois de simulation) parce que le frein (`effectiveNewPerDay`) raisonnait en
// valeur absolue (`SRS.sessionCap`) au lieu de la capacité réelle de l'objectif.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSrsDaily, localDateString, putLessonProgress, putMeta, _resetDbForTests } from "./db";
import { buildSession, gradeCard, sessionStats } from "./reviewSession";
import { enrollLesson } from "./enroll";
import { getCurriculum } from "./curriculum";
import { loadSettings, saveSettings } from "./settings";
import { BACKLOG_STOP_DAYS } from "./tuning";
import type { KuromojiToken } from "./tokenizer";

// Corpus d'exemples statique neutralisé et tokeniseur bouchonné : mêmes raisons que
// reviewSession.test.ts — la simulation ne doit dépendre que des items qu'elle sème.
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  staticExample: () => null,
}));
vi.mock("./tokenizer", () => ({
  tokenize: vi.fn(async (text: string): Promise<KuromojiToken[]> =>
    [...text.replace(/[。、]/g, "")].map((ch) => ({
      surface_form: ch,
      pos: "名詞",
      pos_detail_1: "*",
      pos_detail_2: "*",
      pos_detail_3: "*",
      conjugated_type: "*",
      conjugated_form: "*",
      basic_form: ch,
    })),
  ),
}));

// `loadSettings` lit localStorage, absent de l'environnement node des tests.
const localStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => void localStore.set(k, v),
  removeItem: (k: string) => void localStore.delete(k),
  clear: () => localStore.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbForTests();
  localStore.clear();
  await putMeta("purge.incidentalCards", true);
});

/** Assez de leçons commencées pour que la réserve de nouveautés ne s'épuise jamais. */
const LESSONS = 60;
const DAYS = 45;

interface Run {
  /** Dû mesuré en fin de chaque journée. */
  due: number[];
  /** Mots/points introduits chaque jour. */
  introduced: number[];
}

/**
 * Joue `DAYS` journées d'un utilisateur assidu : il enchaîne les blocs jusqu'à son objectif
 * du jour (le flux d'étude, sans renforcement facultatif) et répond « bien » partout — le
 * cas le PLUS favorable. Si le dû diverge ici, il diverge pour tout le monde.
 */
async function simulate(dailyGoal: number, newPerDay: number): Promise<Run> {
  for (const lesson of getCurriculum().slice(0, LESSONS)) {
    await enrollLesson(lesson.id);
    await putLessonProgress({ id: lesson.id, startedAt: Date.now() });
  }
  saveSettings({ ...loadSettings(), dailyGoal, newPerDay });

  const start = new Date("2026-01-01T08:00:00");
  const run: Run = { due: [], introduced: [] };
  for (let day = 0; day < DAYS; day++) {
    let now = new Date(start.getTime() + day * 86_400_000);
    // Garde-fou : une journée ne doit jamais tourner en boucle, même si le bloc revient vide.
    for (let block = 0; block < 10; block++) {
      const daily = await getSrsDaily(localDateString(now));
      if ((daily?.reviewed ?? 0) >= dailyGoal) break;
      const deck = await buildSession(now);
      if (deck.length === 0) break;
      for (const ex of deck) {
        await gradeCard(ex, "good", now);
        now = new Date(now.getTime() + 20_000); // ~20 s par carte
      }
    }
    run.due.push((await sessionStats(now)).dueCount);
    run.introduced.push((await getSrsDaily(localDateString(now)))?.introduced ?? 0);
  }
  return run;
}

describe("le retard reste borné", () => {
  it("objectif 10 / réglage 10 mots neufs : le dû ne s'emballe pas", async () => {
    const goal = 10;
    const { due, introduced } = await simulate(goal, 10);

    // Le dû reste sous le palier de coupure du frein — il ne s'installe pas au-dessus.
    const ceiling = goal * BACKLOG_STOP_DAYS;
    expect(Math.max(...due)).toBeLessThanOrEqual(ceiling);

    // Et surtout : pas de DÉRIVE. Le dernier tiers n'est pas plus chargé que le premier.
    const third = Math.floor(DAYS / 3);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(due.slice(-third))).toBeLessThanOrEqual(mean(due.slice(0, third)) + goal);

    // Le frein ne doit pas non plus geler la progression : on introduit tous les jours.
    const total = introduced.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(DAYS); // au moins un mot par jour en moyenne
  }, 120_000);
});
