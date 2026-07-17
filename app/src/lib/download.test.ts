import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, getMeta, putMeta, putStory, type StoryRecord } from "./db";
import { PACK_VERSION, type PodcastSegment } from "./podcastScript";
import type { Lesson } from "./lessons";

// Pipeline mocké : chaque primitive pousse son nom dans `calls` pour vérifier l'ordre.
// Les mocks TTS écrivent le VRAI cache (clés réelles) : la vérification finale du
// téléchargement relit ces clés — un mock qui n'écrit pas simule un cache troué.
const calls: string[] = [];

vi.mock("./analyze", () => ({
  analyze: vi.fn(async () => ({
    // 2 phrases pour la matérialisation audio (splitSentences coupe sur 「。」).
    tokens: [{ surface: "猫" }, { surface: "。" }, { surface: "犬" }, { surface: "。" }],
    gloss: [],
  })),
}));

// Pack avec segments parlés (dont un mixte et un tokenisé) : la matérialisation audio du
// pack est exercée sur les deux routes (parts multi-voix / phrase avec timepoints).
const PACK_SEGMENTS: PodcastSegment[] = [
  { id: "p0", chapter: "cours", lang: "fr", text: "Bienvenue." },
  {
    id: "p1",
    chapter: "histoire",
    lang: "ja",
    text: "鳥。",
    tokens: ["鳥", "。"],
    baseTokenIndex: 0,
    storyId: "ls1",
  },
  {
    id: "p2",
    chapter: "histoire",
    lang: "ja",
    text: "猫がいる。 Il y a un chat.",
    parts: [
      { lang: "ja", text: "猫がいる。" },
      { lang: "fr", text: "Il y a un chat." },
    ],
  },
];

vi.mock("./podcast", () => ({
  ensureStoryTranslationById: vi.fn(async () => {
    calls.push("translation");
    return { titleFr: "t", sentences: [] };
  }),
  generatePodcastPack: vi.fn(async (_id: string, _nav: unknown, onProgress?: (m: string) => void) => {
    calls.push("pack");
    onProgress?.("Pack podcast…");
    return { id: _id, segments: PACK_SEGMENTS, createdAt: 0, version: PACK_VERSION };
  }),
}));

vi.mock("./stories", () => ({
  ensureComprehensionQuiz: vi.fn(async () => {
    calls.push("qcm");
    return [];
  }),
}));

vi.mock("./ttsClient", async (orig) => {
  const actual = (await orig()) as typeof import("./ttsClient");
  return {
    ...actual,
    synthesizeSentence: vi.fn(async (segments: string[]) => {
      calls.push("tts");
      const { putTtsCache: put } = await import("./db");
      await put(actual.ttsSentenceCacheId(segments), new Blob(), []);
      return { audio: new Blob(), marks: [] };
    }),
    synthesizeParts: vi.fn(async (parts: Parameters<typeof actual.ttsPartsCacheId>[0]) => {
      calls.push("tts-pack");
      const { putTtsCache: put } = await import("./db");
      await put(actual.ttsPartsCacheId(parts), new Blob(), []);
      return new Blob();
    }),
  };
});

vi.mock("./lessons", async (orig) => {
  const actual = (await orig()) as typeof import("./lessons");
  return {
    ...actual,
    getLesson: vi.fn(),
    ensureLessonFraming: vi.fn(async () => {
      calls.push("framing");
      return "cours";
    }),
    addLessonStory: vi.fn(),
    backfillStoryImage: vi.fn(async () => {
      calls.push("image");
      return new Blob();
    }),
  };
});

import { analyze } from "./analyze";
import {
  _resetDownloadsForTests,
  cancelQueued,
  downloadLesson,
  downloadStory,
  DOWNLOAD_VERSION,
  enqueueDownload,
  getDownloadEntry,
  isLessonDownloaded,
  isStoryDownloaded,
  subscribeDownloads,
} from "./download";
import { objectivesHash } from "./lessons";
import * as lessonsMod from "./lessons";
import * as podcastMod from "./podcast";
import * as ttsMod from "./ttsClient";

const synthesizeSentence = vi.mocked(ttsMod.synthesizeSentence);
const synthesizeParts = vi.mocked(ttsMod.synthesizeParts);
const ensureStoryTranslationById = vi.mocked(podcastMod.ensureStoryTranslationById);
const getLesson = vi.mocked(lessonsMod.getLesson);
const addLessonStory = vi.mocked(lessonsMod.addLessonStory);

function fakeStory(id: string, over: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id,
    createdAt: Date.now(),
    title: "猫",
    text: "猫。犬。",
    params: { level: 5 },
    ...over,
  };
}

function fakeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "l1",
    order: 1,
    rev: 1,
    level: 5,
    title: "Leçon",
    summary: "",
    objectives: { vocab: [], grammar: [] },
    introduces: { vocab: [], grammar: [] },
    state: "ready",
    stories: [],
    pregenerated: false,
    remoteStoryVariants: [],
    mastery: 0,
    unlockProgress: 0,
    locked: false,
    ...over,
  } as unknown as Lesson;
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbForTests();
  _resetDownloadsForTests();
  calls.length = 0;
  vi.clearAllMocks();
});

describe("downloadStory", () => {
  it("enchaîne traduction → QCM → audio, progression monotone jusqu'à 1, flag écrit", async () => {
    await putStory(fakeStory("s1", { params: { level: 5, grammarIds: ["n5-wa-topic"] } }));
    const fractions: number[] = [];
    await downloadStory("s1", ({ fraction }) => fractions.push(fraction));

    expect(calls).toEqual(["translation", "qcm", "tts", "tts"]);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    expect(fractions.at(-1)).toBe(1);
    expect(await isStoryDownloaded("s1")).toBe(true);
  });

  it("histoire libre sans grammaire : QCM et illustration sautés", async () => {
    await putStory(fakeStory("s2"));
    await downloadStory("s2");
    expect(calls).toEqual(["translation", "tts", "tts"]);
  });

  it("TTS non configuré (échec persistant) : téléchargement en échec, pas de flag", async () => {
    await putStory(fakeStory("s3"));
    const err = new Error("Synthèse vocale non configurée côté serveur.");
    synthesizeSentence.mockRejectedValueOnce(err).mockRejectedValueOnce(err);
    await expect(downloadStory("s3")).rejects.toThrow("Synthèse vocale non configurée");
    expect(await isStoryDownloaded("s3")).toBe(false);
  });

  it("échec QCM : best-effort, le téléchargement aboutit quand même", async () => {
    await putStory(fakeStory("s4", { params: { level: 5, grammarIds: ["n5-wa-topic"] } }));
    const { ensureComprehensionQuiz } = await import("./stories");
    vi.mocked(ensureComprehensionQuiz).mockRejectedValueOnce(new Error("offline"));
    await downloadStory("s4");
    expect(await isStoryDownloaded("s4")).toBe(true);
  });

  it("erreur TTS ponctuelle : retentée, le téléchargement aboutit", async () => {
    await putStory(fakeStory("s5b"));
    synthesizeSentence.mockRejectedValueOnce(new Error("HTTP 500"));
    await downloadStory("s5b");
    expect(await isStoryDownloaded("s5b")).toBe(true);
    // 2 phrases + 1 nouvelle tentative sur la première.
    expect(synthesizeSentence).toHaveBeenCalledTimes(3);
  });

  it("erreur TTS persistante (2 échecs) : propagée, pas de flag", async () => {
    await putStory(fakeStory("s5"));
    synthesizeSentence.mockRejectedValueOnce(new Error("HTTP 500")).mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(downloadStory("s5")).rejects.toThrow("HTTP 500");
    expect(await isStoryDownloaded("s5")).toBe(false);
  });

  it("synthèse « réussie » mais cache troué : la vérification finale échoue, pas de flag", async () => {
    await putStory(fakeStory("s6"));
    // Le mock répond sans écrire le cache (écriture perdue, quota plein…) : une fois par phrase.
    const silent = { audio: new Blob(), marks: [] };
    synthesizeSentence.mockResolvedValueOnce(silent).mockResolvedValueOnce(silent);
    await expect(downloadStory("s6")).rejects.toThrow("Audio manquant en cache (2/2)");
    expect(await isStoryDownloaded("s6")).toBe(false);
  });

  it("histoire disparue : no-op sans flag", async () => {
    await downloadStory("absente");
    expect(await isStoryDownloaded("absente")).toBe(false);
  });
});

describe("downloadLesson", () => {
  it("cours → variantes distantes → assets par histoire → pack + son audio, flags écrits", async () => {
    const s1 = fakeStory("ls1", { lessonId: "l1", variant: 1 });
    // 1er getLesson : une variante distante 2 ; ensuite elle est matérialisée.
    const before = fakeLesson({ stories: [s1], remoteStoryVariants: [2] });
    const s2 = fakeStory("ls2", { lessonId: "l1", variant: 2 });
    const after = fakeLesson({ stories: [s1, s2], remoteStoryVariants: [] });
    // « before » au départ ET au re-fetch de la boucle (la variante 2 n'est matérialisée
    // qu'après addLessonStory) ; « after » ensuite.
    getLesson.mockResolvedValueOnce(before).mockResolvedValueOnce(before).mockResolvedValue(after);
    addLessonStory.mockImplementation(async () => {
      calls.push("add-story");
      return s2;
    });
    await putStory(s1);
    await putStory(s2);

    await downloadLesson("l1");
    expect(calls[0]).toBe("framing");
    expect(calls).toContain("add-story");
    expect(calls).toContain("pack");
    // L'audio du pack est matérialisé APRÈS l'assemblage : segments à tokens en phrase
    // (timepoints, cache partagé avec la lecture standalone), les autres en multi-voix.
    expect(calls.at(-1)).toBe("tts-pack");
    expect(synthesizeParts).toHaveBeenCalledTimes(2); // p0 + p2 (p1, tokenisé, passe en phrase)
    expect(synthesizeSentence).toHaveBeenCalledWith(["鳥", "。"], 0);
    // 2 histoires × (traduction + 2 phrases audio)
    expect(ensureStoryTranslationById).toHaveBeenCalledTimes(2);
    expect(await isStoryDownloaded("ls1")).toBe(true);
    expect(await isStoryDownloaded("ls2")).toBe(true);
    expect(await isLessonDownloaded(after)).toBe(true);
  });

  it("audio du pack au cache troué : échec, pas de flag leçon", async () => {
    const s1 = fakeStory("ls1", { lessonId: "l1", variant: 1 });
    const lesson = fakeLesson({ stories: [s1], remoteStoryVariants: [] });
    getLesson.mockResolvedValue(lesson);
    await putStory(s1);
    // Les phrases d'histoire s'écrivent normalement ; le pack, lui, répond sans écrire
    // (une fois par segment parlé).
    synthesizeParts.mockResolvedValueOnce(new Blob()).mockResolvedValueOnce(new Blob());
    await expect(downloadLesson("l1")).rejects.toThrow("Audio manquant en cache");
    expect(await isLessonDownloaded(lesson)).toBe(false);
  });

  it("ne rappelle pas addLessonStory pour une variante déjà matérialisée", async () => {
    const s1 = fakeStory("ls1", { lessonId: "l1", variant: 1 });
    const lesson = fakeLesson({ stories: [s1], remoteStoryVariants: [] });
    getLesson.mockResolvedValue(lesson);
    await putStory(s1);
    await downloadLesson("l1");
    expect(addLessonStory).not.toHaveBeenCalled();
  });
});

describe("isLessonDownloaded — matrice d'invalidation", () => {
  async function seedFlag(lesson: Lesson, over: Record<string, unknown> = {}) {
    await putMeta(`download.lesson.${lesson.id}`, {
      at: Date.now(),
      version: DOWNLOAD_VERSION,
      variants: [1],
      objectivesHash: objectivesHash(lesson),
      rev: lesson.rev,
      packVersion: PACK_VERSION,
      ...over,
    });
  }
  const base = () =>
    fakeLesson({ stories: [fakeStory("ls1", { lessonId: "l1", variant: 1 })], remoteStoryVariants: [] });

  it("cas nominal : téléchargée", async () => {
    const l = base();
    await seedFlag(l);
    expect(await isLessonDownloaded(l)).toBe(true);
  });

  it("flag absent → non téléchargée", async () => {
    expect(await isLessonDownloaded(base())).toBe(false);
  });

  it("rev différente → invalide", async () => {
    const l = base();
    await seedFlag(l, { rev: 99 });
    expect(await isLessonDownloaded(l)).toBe(false);
  });

  it("objectifs changés (curriculum) → invalide", async () => {
    const l = base();
    await seedFlag(l, { objectivesHash: "autre" });
    expect(await isLessonDownloaded(l)).toBe(false);
  });

  it("format de pack podcast changé → invalide", async () => {
    const l = base();
    await seedFlag(l, { packVersion: PACK_VERSION - 1 });
    expect(await isLessonDownloaded(l)).toBe(false);
  });

  it("nouvelle variante distante disponible → invalide", async () => {
    const l = base();
    await seedFlag(l);
    l.remoteStoryVariants = [2];
    expect(await isLessonDownloaded(l)).toBe(false);
  });

  it("histoire téléchargée puis supprimée localement → invalide", async () => {
    const l = base();
    await seedFlag(l, { variants: [1, 2] });
    expect(await isLessonDownloaded(l)).toBe(false);
  });

  it("version de téléchargement obsolète → invalide", async () => {
    const l = base();
    await seedFlag(l, { version: DOWNLOAD_VERSION - 1 });
    expect(await isLessonDownloaded(l)).toBe(false);
  });
});

describe("file de téléchargement", () => {
  it("sérialise : le 2e démarre après la fin du 1er ; doublon en file = no-op", async () => {
    await putStory(fakeStory("q1"));
    await putStory(fakeStory("q2"));

    // Bloque la 1re traduction pour observer la file.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ensureStoryTranslationById.mockImplementationOnce(async () => {
      await gate;
      calls.push("translation");
      return { titleFr: "t", sentences: [] };
    });

    const idle = new Promise<void>((resolve) => {
      const unsub = subscribeDownloads(() => {
        if (!getDownloadEntry("story", "q1") && !getDownloadEntry("story", "q2")) {
          unsub();
          resolve();
        }
      });
    });

    enqueueDownload("story", "q1");
    enqueueDownload("story", "q2");
    enqueueDownload("story", "q1"); // doublon → no-op
    expect(getDownloadEntry("story", "q1")?.status).toBe("downloading");
    expect(getDownloadEntry("story", "q2")?.status).toBe("queued");
    // q1 atteint sa traduction (bloquée) ; q2 attend son tour dans la file.
    await vi.waitFor(() => expect(ensureStoryTranslationById).toHaveBeenCalledTimes(1));
    expect(getDownloadEntry("story", "q2")?.status).toBe("queued");

    release();
    await idle;
    expect(ensureStoryTranslationById).toHaveBeenCalledTimes(2);
    expect(await isStoryDownloaded("q1")).toBe(true);
    expect(await isStoryDownloaded("q2")).toBe(true);
  });

  it("cancelQueued retire une entrée en file (pas celle en cours)", async () => {
    await putStory(fakeStory("q3"));
    await putStory(fakeStory("q4"));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    ensureStoryTranslationById.mockImplementationOnce(async () => {
      await gate;
      return { titleFr: "t", sentences: [] };
    });

    const idle = new Promise<void>((resolve) => {
      const unsub = subscribeDownloads(() => {
        if (!getDownloadEntry("story", "q3")) {
          unsub();
          resolve();
        }
      });
    });

    enqueueDownload("story", "q3");
    enqueueDownload("story", "q4");
    cancelQueued("story", "q4");
    expect(getDownloadEntry("story", "q4")).toBeUndefined();
    cancelQueued("story", "q3"); // en cours → no-op
    expect(getDownloadEntry("story", "q3")?.status).toBe("downloading");

    release();
    await idle;
    expect(await isStoryDownloaded("q3")).toBe(true);
    expect(await isStoryDownloaded("q4")).toBe(false);
  });

  it("erreur → entrée en état error, relançable via enqueue", async () => {
    await putStory(fakeStory("q5"));
    // Deux échecs consécutifs : l'échec ponctuel étant retenté, seul un échec persistant
    // fait passer l'entrée en erreur.
    synthesizeSentence.mockRejectedValueOnce(new Error("réseau")).mockRejectedValueOnce(new Error("réseau"));

    const errored = new Promise<void>((resolve) => {
      const unsub = subscribeDownloads(() => {
        if (getDownloadEntry("story", "q5")?.status === "error") {
          unsub();
          resolve();
        }
      });
    });
    enqueueDownload("story", "q5");
    await errored;
    expect(getDownloadEntry("story", "q5")?.error).toContain("réseau");

    const done = new Promise<void>((resolve) => {
      const unsub = subscribeDownloads(() => {
        if (!getDownloadEntry("story", "q5")) {
          unsub();
          resolve();
        }
      });
    });
    enqueueDownload("story", "q5"); // retry
    await done;
    expect(await isStoryDownloaded("q5")).toBe(true);
  });
});

describe("flag histoire", () => {
  it("écrit version + date dans meta, sans autre champ", async () => {
    await putStory(fakeStory("s9"));
    await downloadStory("s9");
    const meta = await getMeta<{ version: number; at: number }>("download.story.s9");
    expect(meta).toEqual({ at: expect.any(Number), version: DOWNLOAD_VERSION });
    expect(vi.mocked(analyze)).toHaveBeenCalled();
  });
});
