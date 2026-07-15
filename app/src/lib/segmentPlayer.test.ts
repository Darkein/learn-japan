import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ttsClient", () => ({
  synthesizeParts: vi.fn(),
  synthesizeSentence: vi.fn(),
}));
vi.mock("./silentWav", () => ({ silentWavUrl: () => "data:audio/wav;silence" }));
vi.mock("./audioFocus", () => ({ primeAudioFocus: vi.fn() }));

import { createSegmentPlayer, tokenAtTime, type SegmentPlayerCallbacks } from "./segmentPlayer";
import * as tts from "./ttsClient";

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

// Élément <audio> minimal pour l'environnement node : juste ce que le moteur touche.
class FakeAudio {
  preload = "";
  loop = false;
  paused = true;
  readyState = 0;
  duration = NaN;
  currentTime = 0;
  onended: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;
  private srcAttr: string | null = null;
  set src(v: string) {
    this.srcAttr = v;
  }
  getAttribute(name: string): string | null {
    return name === "src" ? this.srcAttr : null;
  }
  removeAttribute(name: string): void {
    if (name === "src") this.srcAttr = null;
  }
  load(): void {}
  async play(): Promise<void> {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(): void {}
}

function callbacks(): { [K in keyof SegmentPlayerCallbacks]: ReturnType<typeof vi.fn> } {
  return { onSegmentStart: vi.fn(), onProgress: vi.fn(), onError: vi.fn(), onToken: vi.fn(), onEnded: vi.fn() };
}

describe("createSegmentPlayer — synthèse cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Audio", FakeAudio);
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:seg");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("erreur de synthèse → onError avec le message, chaîne stoppée", async () => {
    vi.mocked(tts.synthesizeParts).mockRejectedValue(new Error("Synthèse vocale non configurée côté serveur."));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0);
    await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
    expect(cb.onError).toHaveBeenCalledWith("Synthèse vocale non configurée côté serveur.");
    expect(cb.onEnded).not.toHaveBeenCalled();
  });

  it("segment mixte → synthesizeParts reçoit les fragments tels quels", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(new Blob());
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    const parts = [
      { lang: "fr" as const, text: "chat " },
      { lang: "ja" as const, text: "猫" },
    ];
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "chat 猫", parts }]);
    player.start(0);
    await vi.waitFor(() => expect(tts.synthesizeParts).toHaveBeenCalledWith(parts));
    expect(cb.onSegmentStart).toHaveBeenCalledWith(0);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("segment monolingue sans parts → un unique fragment (texte entier)", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(new Blob());
    const player = createSegmentPlayer(callbacks());
    player.setSegments([{ id: "s0", chapter: "histoire", lang: "ja", text: "猫がいる。" }]);
    player.start(0);
    await vi.waitFor(() =>
      expect(tts.synthesizeParts).toHaveBeenCalledWith([{ lang: "ja", text: "猫がいる。" }]),
    );
  });

  it("segment tokenisé (histoire) → synthesizeSentence avec l'index global", async () => {
    vi.mocked(tts.synthesizeSentence).mockResolvedValue({ audio: new Blob(), marks: [] });
    const player = createSegmentPlayer(callbacks());
    player.setSegments([
      { id: "s0", chapter: "histoire", lang: "ja", text: "猫がいる。", tokens: ["猫", "が", "いる", "。"], baseTokenIndex: 7 },
    ]);
    player.start(0);
    await vi.waitFor(() => expect(tts.synthesizeSentence).toHaveBeenCalledWith(["猫", "が", "いる", "。"], 7));
    expect(tts.synthesizeParts).not.toHaveBeenCalled();
  });
});
