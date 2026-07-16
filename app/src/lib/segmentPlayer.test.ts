import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ttsClient", () => ({
  synthesizeParts: vi.fn(),
  synthesizeSentence: vi.fn(),
}));

import { createSegmentPlayer, tokenAtTime, type SegmentPlayerCallbacks } from "./segmentPlayer";
import { SILENT_FRAME_MS, silentFrame, silentMp3Bytes } from "./silentMp3";
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

// ---------------------------------------------------------------------------
// Banc d'essai : MediaSource/SourceBuffer/Audio factices pour l'environnement
// node. Tous les octets appondus sont des trames MP3 silencieuses (silentMp3.ts),
// donc la durée de chaque append se déduit du nombre de trames — le buffer factice
// reproduit exactement la chronologie que produirait le vrai parseur `audio/mpeg`.
// ---------------------------------------------------------------------------

const FRAME_BYTES = silentFrame().length;
const bytesToSeconds = (n: number) => ((n / FRAME_BYTES) * SILENT_FRAME_MS) / 1000;
/** Blob « audio TTS » factice : du silence MP3 de la durée voulue. */
const clipBlob = (ms: number) => new Blob([silentMp3Bytes(ms) as unknown as BlobPart]);

class FakeSourceBuffer {
  mode = "segments";
  updating = false;
  timestampOffset = 0;
  rangeStart = 0;
  rangeEnd = 0;
  hasData = false;
  private pending: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  get buffered() {
    const self = this;
    return {
      get length() {
        return self.hasData ? 1 : 0;
      },
      start: () => self.rangeStart,
      end: () => self.rangeEnd,
    };
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === "updateend") this.listeners.push(fn);
  }
  appendBuffer(bytes: Uint8Array): void {
    if (this.updating) throw new Error("appendBuffer pendant updating");
    this.updating = true;
    this.pending = () => {
      this.rangeEnd = Math.max(this.rangeEnd, this.timestampOffset) + bytesToSeconds(bytes.length);
      this.hasData = true;
    };
  }
  remove(start: number, end: number): void {
    if (this.updating) throw new Error("remove pendant updating");
    this.updating = true;
    this.pending = () => {
      if (end >= this.rangeEnd) this.rangeEnd = Math.min(this.rangeEnd, start);
      else this.rangeStart = Math.max(this.rangeStart, end);
    };
  }
  /** Termine l'opération en cours (comme le ferait le parseur) et émet `updateend`. */
  complete(): boolean {
    if (!this.updating) return false;
    this.pending?.();
    this.pending = null;
    this.updating = false;
    for (const fn of this.listeners) fn();
    return true;
  }
}

class FakeMediaSource {
  static instances: FakeMediaSource[] = [];
  static isTypeSupported = () => true;
  readyState = "closed";
  sb: FakeSourceBuffer | null = null;
  private onOpen: (() => void) | null = null;
  constructor() {
    FakeMediaSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === "sourceopen") this.onOpen = fn;
  }
  addSourceBuffer(type: string): FakeSourceBuffer {
    expect(type).toBe("audio/mpeg");
    this.sb = new FakeSourceBuffer();
    return this.sb;
  }
  open(): void {
    this.readyState = "open";
    this.onOpen?.();
  }
}

class FakeAudio {
  static current: FakeAudio | null = null;
  preload = "";
  paused = true;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  ontimeupdate: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private srcAttr: string | null = null;
  constructor() {
    FakeAudio.current = this;
  }
  set src(v: string) {
    this.srcAttr = v;
    // L'attachement d'un object URL de MediaSource ouvre la source (async en vrai).
    FakeMediaSource.instances.at(-1)?.open();
  }
  getAttribute(name: string): string | null {
    return name === "src" ? this.srcAttr : null;
  }
  removeAttribute(name: string): void {
    if (name === "src") this.srcAttr = null;
  }
  load(): void {
    // L'algorithme de chargement du média réinitialise playbackRate (spec HTML).
    this.playbackRate = this.defaultPlaybackRate;
  }
  async play(): Promise<void> {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
}

function callbacks(): { [K in keyof SegmentPlayerCallbacks]: ReturnType<typeof vi.fn> } {
  return { onSegmentStart: vi.fn(), onProgress: vi.fn(), onError: vi.fn(), onToken: vi.fn(), onEnded: vi.fn() };
}

const audio = () => FakeAudio.current!;
const sourceBuffer = () => FakeMediaSource.instances.at(-1)!.sb!;

/** Laisse la pompe se stabiliser : résout les synthèses en vol et termine les appends. */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await Promise.resolve();
    await Promise.resolve();
    const sb = FakeMediaSource.instances.at(-1)?.sb;
    if (!sb?.complete()) {
      await Promise.resolve();
      await Promise.resolve();
      if (!sb || !sb.updating) return;
    }
  }
  throw new Error("la pompe ne se stabilise pas");
}

/** Avance la tête de lecture (bornée au bufferisé) et émet `timeupdate`. */
async function tick(dt: number): Promise<void> {
  const a = audio();
  a.currentTime = Math.min(a.currentTime + dt, sourceBuffer().rangeEnd);
  a.ontimeupdate?.();
  await settle();
}

describe("createSegmentPlayer — flux continu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeMediaSource.instances = [];
    FakeAudio.current = null;
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("MediaSource", FakeMediaSource);
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:ms");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("segment mixte → synthesizeParts reçoit les fragments tels quels", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    const parts = [
      { lang: "fr" as const, text: "chat " },
      { lang: "ja" as const, text: "猫" },
    ];
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "chat 猫", parts }]);
    player.start(0);
    await settle();
    expect(tts.synthesizeParts).toHaveBeenCalledWith(parts);
    await tick(0.1);
    expect(cb.onSegmentStart).toHaveBeenCalledWith(0);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("segment monolingue sans parts → un unique fragment (texte entier)", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const player = createSegmentPlayer(callbacks());
    player.setSegments([{ id: "s0", chapter: "histoire", lang: "ja", text: "猫がいる。" }]);
    player.start(0);
    await settle();
    expect(tts.synthesizeParts).toHaveBeenCalledWith([{ lang: "ja", text: "猫がいる。" }]);
  });

  it("segment tokenisé (histoire) → synthesizeSentence avec l'index global", async () => {
    vi.mocked(tts.synthesizeSentence).mockResolvedValue({ audio: clipBlob(2000), marks: [] });
    const player = createSegmentPlayer(callbacks());
    player.setSegments([
      { id: "s0", chapter: "histoire", lang: "ja", text: "猫がいる。", tokens: ["猫", "が", "いる", "。"], baseTokenIndex: 7 },
    ]);
    player.start(0);
    await settle();
    expect(tts.synthesizeSentence).toHaveBeenCalledWith(["猫", "が", "いる", "。"], 7);
    expect(tts.synthesizeParts).not.toHaveBeenCalled();
  });

  it("échec de synthèse → une relance différée, puis onError et chaîne stoppée", async () => {
    vi.mocked(tts.synthesizeParts).mockRejectedValue(new Error("Synthèse vocale non configurée côté serveur."));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0);
    await settle();
    // Premier échec : pas encore d'erreur, le silence tampon maintient le flux.
    expect(cb.onError).not.toHaveBeenCalled();
    expect(tts.synthesizeParts).toHaveBeenCalledTimes(1);
    // La tête avance dans le silence au-delà du délai de relance → deuxième échec.
    await tick(2.5);
    await tick(0.5);
    expect(tts.synthesizeParts).toHaveBeenCalledTimes(2);
    expect(cb.onError).toHaveBeenCalledWith("Synthèse vocale non configurée côté serveur.");
    expect(cb.onEnded).not.toHaveBeenCalled();
    expect(audio().paused).toBe(true);
  });

  it("enchaîne segments et blanc de quiz dans le même flux, puis signale la fin", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([
      { id: "s0", chapter: "quiz", lang: "fr", text: "Comment dit-on chat ?", pauseAfterMs: 1000 },
      { id: "s1", chapter: "quiz", lang: "ja", text: "猫" },
    ]);
    player.start(0);
    await settle();
    // Le démarrage saute le silence d'amorçage : la tête est posée au début du segment 0.
    await tick(0);
    expect(cb.onSegmentStart).toHaveBeenCalledWith(0);
    const pos0 = player.getPosition();
    expect(pos0).not.toBeNull();
    expect(pos0!.duration).toBeCloseTo(2.016, 2); // 2000 ms arrondis à la trame (84 × 24 ms)
    // Progression dans le segment 0.
    await tick(1);
    expect(cb.onProgress).toHaveBeenLastCalledWith(expect.closeTo(1 / 2.016, 2));
    // Blanc de quiz : plus de position « segment », pas de fin de piste.
    await tick(1.5);
    expect(player.getPosition()).toBeNull();
    expect(cb.onEnded).not.toHaveBeenCalled();
    // Segment 1 après le blanc.
    await tick(1);
    expect(cb.onSegmentStart).toHaveBeenLastCalledWith(1);
    expect(player.index()).toBe(1);
    // Fin du segment 1 → onEnded, une seule fois.
    await tick(2.1);
    await tick(0.1);
    expect(cb.onEnded).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it("surligne les tokens du segment courant via ses timepoints", async () => {
    vi.mocked(tts.synthesizeSentence).mockResolvedValue({
      audio: clipBlob(2000),
      marks: [
        { i: 7, t: 0 },
        { i: 8, t: 1.0 },
      ],
    });
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([
      { id: "s0", chapter: "histoire", lang: "ja", text: "猫がいる。", tokens: ["猫", "が", "いる", "。"], baseTokenIndex: 7 },
    ]);
    player.start(0);
    await settle();
    await tick(0.1);
    expect(cb.onToken).toHaveBeenLastCalledWith(7);
    await tick(1.2);
    expect(cb.onToken).toHaveBeenLastCalledWith(8);
  });

  it("start(i, offset) reprend au bon endroit du segment", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0, 0.5);
    await settle();
    await tick(0);
    const pos = player.getPosition();
    expect(pos).not.toBeNull();
    expect(pos!.currentTime / pos!.duration).toBeCloseTo(0.5, 2);
  });

  it("pause en place puis resume : le flux reste attaché, la lecture repart", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0);
    await settle();
    await tick(0.5);
    player.pause();
    expect(audio().paused).toBe(true);
    expect(audio().getAttribute("src")).not.toBeNull();
    const t = audio().currentTime;
    player.resume();
    await settle();
    expect(audio().paused).toBe(false);
    expect(audio().currentTime).toBe(t); // reprise au même endroit, pas de redémarrage
  });

  it("setRate s'applique à l'élément et survit au halt (load() réinitialise playbackRate)", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const player = createSegmentPlayer(callbacks());
    player.setRate(1.5); // avant même la création de l'élément
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0);
    await settle();
    expect(audio().playbackRate).toBe(1.5);
    player.halt(); // load() → playbackRate = defaultPlaybackRate, qui doit porter la vitesse
    player.start(0);
    await settle();
    expect(audio().playbackRate).toBe(1.5);
    player.setRate(0.75); // changement en cours de lecture : effet immédiat
    expect(audio().playbackRate).toBe(0.75);
  });

  it("standby coupe la piste mais entretient le silence ; halt détache tout", async () => {
    vi.mocked(tts.synthesizeParts).mockResolvedValue(clipBlob(2000));
    const cb = callbacks();
    const player = createSegmentPlayer(cb);
    player.setSegments([{ id: "s0", chapter: "cours", lang: "fr", text: "Bonjour." }]);
    player.start(0);
    await settle();
    await tick(0.5);
    player.standby();
    await settle();
    // La synthèse de l'ancienne génération est invalidée mais le flux vit toujours.
    expect(audio().paused).toBe(false);
    await tick(5);
    expect(cb.onEnded).not.toHaveBeenCalled();
    expect(sourceBuffer().rangeEnd).toBeGreaterThan(audio().currentTime); // silence devant la tête
    player.halt();
    expect(audio().getAttribute("src")).toBeNull();
  });
});
