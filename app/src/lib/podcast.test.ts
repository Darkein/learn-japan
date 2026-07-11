import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, getPodcast, putStory, type StoryRecord } from "./db";
import type { Lesson } from "./lessons";
import { PACK_VERSION, type PodcastSegment } from "./podcastScript";

// Ordre des effets observé via `calls` : le pack doit être ENREGISTRÉ avant la synthèse.
const calls: string[] = [];

const SEGMENTS: PodcastSegment[] = [
  { id: "s0", chapter: "cours", lang: "fr", text: "Bienvenue." },
  { id: "s1", chapter: "quiz", lang: "ja", text: "ねこ", pauseAfterMs: 5000 },
];

vi.mock("./podcastScript", async (orig) => {
  const actual = (await orig()) as typeof import("./podcastScript");
  return { ...actual, buildPodcastScript: () => SEGMENTS };
});

vi.mock("./lessons", async (orig) => {
  const actual = (await orig()) as typeof import("./lessons");
  return {
    ...actual,
    getLesson: vi.fn(),
    ensureLessonFraming: vi.fn(async () => "cours"),
    addLessonStory: vi.fn(),
  };
});

vi.mock("./stories", () => ({
  ensureComprehensionQuiz: vi.fn(async () => []),
}));

vi.mock("./ttsClient", async (orig) => {
  const actual = (await orig()) as typeof import("./ttsClient");
  return {
    ...actual,
    synthesizeText: vi.fn(async () => {
      calls.push("tts");
      return new Blob();
    }),
  };
});

vi.mock("./db", async (orig) => {
  const actual = (await orig()) as typeof import("./db");
  return {
    ...actual,
    putPodcast: vi.fn(async (rec: unknown) => {
      calls.push("putPodcast");
      return actual.putPodcast(rec as Parameters<typeof actual.putPodcast>[0]);
    }),
  };
});

import { generatePodcastPack } from "./podcast";
import * as lessonsMod from "./lessons";
import * as ttsMod from "./ttsClient";

const getLesson = vi.mocked(lessonsMod.getLesson);
const synthesizeText = vi.mocked(ttsMod.synthesizeText);

// Histoire à traduction propre : ensureStoryTranslation ne déclenche pas le LLM.
function cleanStory(): StoryRecord {
  return {
    id: "st1",
    createdAt: Date.now(),
    title: "猫",
    text: "猫。",
    params: { level: 5 },
    lessonId: "l1",
    titleFr: "Le chat",
    translation: ["Le chat."],
  };
}

function fakeLesson(): Lesson {
  return {
    id: "l1",
    order: 1,
    rev: 1,
    level: 5,
    title: "Leçon",
    summary: "",
    framing: "cours",
    objectives: { vocab: [], grammar: [] },
    introduces: { vocab: [], grammar: [] },
    state: "ready",
    stories: [cleanStory()],
    pregenerated: false,
    remoteStoryVariants: [],
    mastery: 0,
    unlockProgress: 0,
    locked: false,
  } as unknown as Lesson;
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  _resetDbForTests();
  calls.length = 0;
  vi.clearAllMocks();
  getLesson.mockResolvedValue(fakeLesson());
  await putStory(cleanStory());
});

describe("generatePodcastPack", () => {
  it("enregistre le pack AVANT le préchauffage audio (préchauffage interrompu → pack jouable)", async () => {
    const rec = await generatePodcastPack("l1");
    expect(rec.version).toBe(PACK_VERSION);
    expect(calls.indexOf("putPodcast")).toBeLessThan(calls.indexOf("tts"));
    expect(await getPodcast("l1")).toMatchObject({ id: "l1", version: PACK_VERSION });
  });

  it("prewarmAudio: false (lecteur) : aucun appel TTS, pack enregistré", async () => {
    await generatePodcastPack("l1", {}, undefined, { prewarmAudio: false });
    expect(synthesizeText).not.toHaveBeenCalled();
    expect(await getPodcast("l1")).toMatchObject({ id: "l1", version: PACK_VERSION });
  });

  it("échec de synthèse ponctuel : retenté, le préchauffage continue", async () => {
    synthesizeText.mockRejectedValueOnce(new Error("HTTP 500"));
    await generatePodcastPack("l1");
    // 2 segments + 1 nouvelle tentative sur le premier.
    expect(synthesizeText).toHaveBeenCalledTimes(3);
  });

  it("échec persistant : propagé, mais le pack est déjà enregistré", async () => {
    synthesizeText
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(generatePodcastPack("l1")).rejects.toThrow("HTTP 500");
    expect(await getPodcast("l1")).toMatchObject({ id: "l1", version: PACK_VERSION });
  });

  it("TTS non configuré : préchauffage abandonné proprement, pack enregistré", async () => {
    synthesizeText.mockRejectedValue(new ttsMod.TtsUnconfiguredError());
    const rec = await generatePodcastPack("l1");
    expect(rec.segments).toHaveLength(2);
    expect(synthesizeText).toHaveBeenCalledTimes(1);
    expect(await getPodcast("l1")).toMatchObject({ id: "l1" });
  });
});
