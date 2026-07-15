import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, getPodcast, putStory, type StoryRecord } from "./db";
import type { Lesson } from "./lessons";
import { PACK_VERSION, type PodcastSegment } from "./podcastScript";

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
    synthesizeParts: vi.fn(async () => new Blob()),
    synthesizeSentence: vi.fn(async () => ({ audio: new Blob(), marks: [] })),
  };
});

import { generatePodcastPack } from "./podcast";
import * as lessonsMod from "./lessons";
import * as ttsMod from "./ttsClient";

const getLesson = vi.mocked(lessonsMod.getLesson);
const synthesizeParts = vi.mocked(ttsMod.synthesizeParts);
const synthesizeSentence = vi.mocked(ttsMod.synthesizeSentence);

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
  vi.clearAllMocks();
  getLesson.mockResolvedValue(fakeLesson());
  await putStory(cleanStory());
});

describe("generatePodcastPack", () => {
  it("assemble et enregistre le pack, à la version courante", async () => {
    const rec = await generatePodcastPack("l1");
    expect(rec.version).toBe(PACK_VERSION);
    expect(rec.segments).toHaveLength(2);
    expect(await getPodcast("l1")).toMatchObject({ id: "l1", version: PACK_VERSION });
  });

  it("ne synthétise AUCUN audio : la matérialisation est l'affaire du téléchargement", async () => {
    await generatePodcastPack("l1");
    expect(synthesizeParts).not.toHaveBeenCalled();
    expect(synthesizeSentence).not.toHaveBeenCalled();
  });

  it("génère une histoire quand la leçon n'en a aucune", async () => {
    const empty = { ...fakeLesson(), stories: [] as StoryRecord[] } as unknown as Lesson;
    getLesson.mockResolvedValueOnce(empty).mockResolvedValue(fakeLesson());
    await generatePodcastPack("l1");
    expect(lessonsMod.addLessonStory).toHaveBeenCalledWith(empty, 1);
  });
});
